/**
 * M7 — Parcours P6 « Factures fournisseurs reçues par Peppol » (aucun humain, puis Sophie) :
 * Sophie commande les matériaux du devis (un BC par fournisseur, envoyé par e-mail), la facture
 * Brico Pro arrive par Peppol avec le numéro de BC → imputée seule au poste, écart de prix signalé,
 * timeline du chantier. Une facture sans référence tombe dans « À imputer » : Sophie la ventile sur
 * deux chantiers. Une facture PDF déposée suit le même flux (extraction IA). Comptable en lecture.
 * Écrans sur téléphone.
 */
import { expect, test } from '@playwright/test';
import {
  acceptInvitation,
  call,
  expectNoA11yViolations,
  expectNoHorizontalOverflow,
  lastEmailTo,
  signedProject,
  signup,
  uniqueEmail,
} from './helpers';

test('P6 : BC depuis le devis, facture Peppol imputée seule, boîte « À imputer » ventilée, dépôt PDF', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await signup(page, { name: 'Sophie Achats', company: 'Rénov Achats P6' });
  const r = page.request;

  // Aucun achat encore : la boîte « À imputer » explique et propose une action.
  await page
    .getByRole('navigation', { name: 'Navigation principale' })
    .getByRole('link', { name: 'Achats' })
    .click();
  await expect(page).toHaveURL(/\/achats\/factures/);
  await expect(page.getByText('Rien à imputer')).toBeVisible();

  // Fournisseur : le numéro d'entreprise donne la TVA et l'identifiant Peppol.
  await page.getByRole('link', { name: 'Fournisseurs', exact: true }).click();
  await page.getByRole('button', { name: 'Nouveau fournisseur' }).first().click();
  const supplierDialog = page.getByRole('dialog', { name: 'Nouveau fournisseur' });
  await supplierDialog.getByLabel('Nom', { exact: true }).fill('Brico Pro SA');
  await supplierDialog.getByLabel('Numéro d’entreprise').fill('0417.497.106');
  const orderEmail = uniqueEmail('commandes-brico');
  await supplierDialog.getByLabel('E-mail des commandes').fill(orderEmail);
  await supplierDialog.getByLabel('Localité').fill('Jumet');
  await supplierDialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Fournisseur ajouté')).toBeVisible();
  await expect(page.getByRole('cell', { name: /0417\.497\.106/ })).toContainText('Peppol 0208:0417497106');
  const suppliers = await call<{ items: { id: string; name: string }[] }>(r, 'GET', '/suppliers');
  const brico = suppliers.items.find((s) => s.name === 'Brico Pro SA')!;
  const gilson = await call<{ id: string }>(r, 'POST', '/suppliers', {
    name: 'Matériaux Gilson SA',
    orderEmail: uniqueEmail('gilson'),
  });

  // P3.3 : les matériaux du devis signé → un bon de commande par fournisseur.
  const { projectId } = await signedProject(page, uniqueEmail('dupont-p6'), { materials: true });
  const { projectId: otherId } = await signedProject(page, uniqueEmail('lejeune-p6'), {
    siteStreet: 'Rue des Vignes 8',
  });
  await page.goto(`/chantiers/${projectId}?onglet=achats`);
  await expect(page.getByText('Rien de commandé')).toBeVisible();
  await page.getByRole('button', { name: 'Commander les matériaux' }).first().click();
  const proposal = page.getByRole('dialog', { name: 'Commander les matériaux du devis' });
  await expect(proposal.getByText('Colle carrelage C2TE 25 kg')).toBeVisible();
  await expect(proposal.getByText('Joint époxy 2,5 kg')).toBeVisible();
  await expect(proposal.getByText('Faïence murale')).toHaveCount(0); // main-d'œuvre : pas commandée
  await proposal.getByLabel('Fournisseur du groupe 1').selectOption({ label: 'Brico Pro SA' });
  await proposal.getByRole('button', { name: 'Créer 1 bon de commande' }).click();
  await expect(page.getByText('1 bon de commande créé (brouillon)')).toBeVisible();

  const drawer = page.getByRole('dialog', { name: 'Brouillon · Brico Pro SA' });
  await expect(drawer.getByLabel('Article 1')).toHaveValue('Colle carrelage C2TE 25 kg');
  await expect(drawer.getByText(/420,00\s€/)).toBeVisible();
  await drawer.getByRole('button', { name: 'Envoyer au fournisseur' }).click();
  const send = page.getByRole('dialog', { name: 'Envoyer la commande à Brico Pro SA' });
  await expect(send.getByLabel('E-mail du fournisseur')).toHaveValue(orderEmail);
  await send.getByRole('button', { name: 'Envoyer', exact: true }).click();
  await expect(page.getByText(new RegExp(`BC\\d{4}-\\d{3} envoyé à ${orderEmail}`))).toBeVisible();
  const sentDrawer = page.getByRole('dialog', { name: /^BC\d{4}-\d{3}$/ });
  await expect(sentDrawer.getByText('Envoyé', { exact: true })).toBeVisible();
  const bc = (await sentDrawer.getByRole('heading').first().textContent())!.trim();
  const mail = await lastEmailTo(orderEmail, new RegExp(`bon de commande ${bc}`));
  expect(mail.text).toContain(bc);
  await sentDrawer.getByRole('button', { name: 'Fermer' }).click();

  // 1. La facture Brico Pro arrive par Peppol avec le n° de BC : imputée seule, écart de prix signalé.
  await call(r, 'POST', '/integrations/peppol/simulate-inbound', {
    supplierId: brico.id,
    number: 'F-2026-0412',
    orderReference: bc,
    lines: [
      { description: 'Colle carrelage C2TE 25 kg', quantity: '12', unitPrice: 2_650, vatRate: '21' },
      { description: 'Joint époxy 2,5 kg', quantity: '4', unitPrice: 3_000, vatRate: '21' },
    ],
  });
  const projectInvoices = page.getByRole('link', { name: /Brico Pro SA\s*F-2026-0412/ });
  await expect(projectInvoices).toBeVisible({ timeout: 30_000 }); // en direct, sans recharger
  await page.getByRole('tab', { name: /Vue d’ensemble/ }).click();
  await expect(page.getByText('Facture Brico Pro SA reçue via Peppol').first()).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('tab', { name: 'Achats' }).click();
  await page.getByRole('link', { name: /Brico Pro SA\s*F-2026-0412/ }).click();
  const invoice = page.getByRole('dialog', { name: 'Brico Pro SA' });
  await expect(invoice.getByText(`grâce au bon de commande ${bc}`)).toBeVisible();
  await expect(invoice.getByText('Écarts avec le bon de commande')).toBeVisible();
  await expect(
    invoice.getByText(/Colle carrelage C2TE 25 kg : 26,50\s€ facturé pour 25,00\s€ commandé/),
  ).toBeVisible();
  await expectNoA11yViolations(page);
  await invoice.getByRole('button', { name: 'Valider' }).click();
  await expect(page.getByText('Facture validée')).toBeVisible();
  await invoice.getByRole('button', { name: 'Mettre à payer' }).click();
  await expect(page.getByText('Facture mise à payer')).toBeVisible();
  await expect(invoice.getByText('À payer', { exact: true })).toBeVisible();
  await invoice.getByRole('button', { name: 'Fermer' }).click();

  // 2. Facture sans référence ni adresse : boîte « À imputer », ventilée sur deux chantiers.
  await call(r, 'POST', '/integrations/peppol/simulate-inbound', {
    supplierId: gilson.id,
    number: 'MG-778',
    lines: [{ description: 'Sable stabilisé (big bag)', quantity: '2', unitPrice: 6_800, vatRate: '21' }],
  });
  await page.getByRole('link', { name: /^Factures fournisseurs/ }).click();
  await page.getByRole('tab', { name: /À imputer/ }).click();
  const row = page.getByRole('button', { name: /Matériaux Gilson SA/ });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  const inbox = page.getByRole('dialog', { name: 'Matériaux Gilson SA' });
  await expect(inbox.getByText('À imputer', { exact: true })).toBeVisible();
  await inbox.getByRole('button', { name: 'Ventiler sur plusieurs chantiers' }).click();
  await inbox.getByLabel('Chantier 1').selectOption(projectId);
  await inbox.getByLabel('Poste 1').selectOption({ label: 'Carrelage' });
  await inbox.getByLabel('Montant HTVA 1').fill('100');
  await expect(inbox.getByText(/Reste à ventiler : 36,00\s€/)).toBeVisible();
  await inbox.getByRole('button', { name: 'Enregistrer l’imputation' }).click();
  await expect(inbox.getByRole('alert')).toContainText('La ventilation doit égaler le total HTVA');
  await inbox.getByRole('button', { name: 'Ajouter un chantier' }).click();
  await inbox.getByLabel('Chantier 2').selectOption(otherId);
  await expect(inbox.getByText('La ventilation égale le total HTVA.')).toBeVisible();
  await inbox.getByRole('button', { name: 'Enregistrer l’imputation' }).click();
  await expect(page.getByText('Imputation enregistrée')).toBeVisible();
  await expect(inbox.getByText('Imputée', { exact: true })).toBeVisible();
  await expect(inbox.getByRole('listitem').filter({ hasText: /100,00\s€/ })).toBeVisible();
  await inbox.getByRole('button', { name: 'Fermer' }).click();
  await expect(page.getByText('Rien à imputer')).toBeVisible();

  // 3. PDF reçu par e-mail et déposé : extraction IA (simulation) puis même rapprochement.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Déposer une facture' }).first().click();
  await (
    await chooser
  ).setFiles({
    name: `Facture ${bc} total 242.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% facture fournisseur de test\n%%EOF\n'),
  });
  await expect(page.getByText('Facture déposée')).toBeVisible();
  const uploaded = page.getByRole('dialog').filter({ hasText: 'Déposée' });
  await expect(uploaded.getByText(`grâce au bon de commande ${bc}`)).toBeVisible({ timeout: 30_000 });
  await expect(uploaded.getByText(/200,00\s€/).first()).toBeVisible();
  await uploaded.getByRole('button', { name: 'Fermer' }).click();

  // Comptable : lecture seule (ni dépôt, ni validation).
  const accountantEmail = uniqueEmail('lambert-p6');
  await call(r, 'POST', '/invitations', { email: accountantEmail, role: 'accountant' });
  const ctx = await browser.newContext();
  const lambert = await ctx.newPage();
  await acceptInvitation(lambert, accountantEmail, 'Isabelle Lambert');
  await lambert.goto('/achats/factures?vue=to_pay');
  await expect(lambert.getByRole('button', { name: /Brico Pro SA/ })).toBeVisible();
  await expect(lambert.getByRole('button', { name: 'Déposer une facture' })).toHaveCount(0);
  await lambert.getByRole('button', { name: /Brico Pro SA/ }).click();
  await expect(lambert.getByRole('dialog', { name: 'Brico Pro SA' }).getByText('F-2026-0412')).toBeVisible();
  await expect(lambert.getByRole('button', { name: 'Marquer payée' })).toHaveCount(0);
  await ctx.close();
});

test('P6 sur téléphone : boîte « À imputer », commandes et fournisseurs @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  await signup(page, { name: 'Sophie Mobile', company: 'Rénov Achats Mobile' });
  const r = page.request;
  const supplier = await call<{ id: string }>(r, 'POST', '/suppliers', { name: 'Brico Pro SA' });
  await call(r, 'POST', '/integrations/peppol/simulate-inbound', {
    supplierId: supplier.id,
    number: 'F-MOB-1',
    lines: [{ description: 'Silicone sanitaire', quantity: '3', unitPrice: 890, vatRate: '21' }],
  });
  await page.goto('/achats');
  await expect(page).toHaveURL(/\/achats\/factures/);
  const row = page.getByRole('button', { name: /Brico Pro SA/ });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expectNoHorizontalOverflow(page);
  await row.click();
  await expect(
    page
      .getByRole('dialog', { name: 'Brico Pro SA' })
      .getByText(/26,70\s€/)
      .first(),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Fermer' }).click();
  for (const name of ['Bons de commande', 'Fournisseurs']) {
    await page.getByRole('link', { name, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Achats' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});
