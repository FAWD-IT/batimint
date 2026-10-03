/**
 * M9 — Parcours P9 « Sous-traitance » : Sophie conclut un contrat sur un poste (consultation 30bis
 * à la création, état visible) et envoie son lien au sous-traitant ; Électro Pirson ouvre son
 * espace (vouvoiement), dépose ses documents (une attestation expirée est signalée) et sa
 * facture ; la facture est imputée au poste du contrat sans saisie ; mise à payer après une
 * nouvelle consultation. Chemin « dette » : la facture est bloquée, la retenue est appliquée et
 * le document de versement est produit. Portail sur téléphone.
 */
import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  call,
  expectNoA11yViolations,
  expectNoHorizontalOverflow,
  lastEmailTo,
  signedProject,
  signup,
  uniqueEmail,
} from './helpers';

const PDF = { name: 'document.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%demo\n') };

async function openPortal(browser: Browser, email: string, mobile = false) {
  const mail = await lastEmailTo(email, /espace sous-traitant/);
  const link = new URL(/(http\S+\/s\/[^\s"<>]+)/.exec(mail.text)![1]!);
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 } } : {});
  const page = await ctx.newPage();
  await page.goto(link.pathname);
  return { ctx, page, token: link.pathname.split('/').pop()! };
}

async function subcontractor(page: Page, name: string, enterpriseNumber: string, email: string) {
  return call<{ id: string }>(page.request, 'POST', '/suppliers', {
    name,
    enterpriseNumber,
    email,
    isSubcontractor: true,
  });
}

async function invoiceOf(page: Page, supplierName: string, status: string) {
  let found: { id: string; status: string; matchMethod: string | null } | undefined;
  await expect
    .poll(
      async () => {
        const list = await call<{
          items: { id: string; status: string; matchMethod: string | null; supplier: { name: string } }[];
        }>(page.request, 'GET', '/supplier-invoices?view=all');
        found = list.items.find((i) => i.supplier.name === supplierName && i.status === status);
        return Boolean(found);
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return found!;
}

test('P9 : contrat sur un poste avec 30bis, portail du sous-traitant, facture imputée ; dette → retenue', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await signup(page, { name: 'Sophie Sous-traitance', company: 'Rénov Sous-traitance P9' });
  const { projectId } = await signedProject(page, uniqueEmail('client-p9'));
  const pirsonEmail = uniqueEmail('pirson');
  await subcontractor(page, 'Électro Pirson SPRL', '0456.789.034', pirsonEmail);
  const debtorEmail = uniqueEmail('lemaire');
  const debtor = await subcontractor(page, 'Façades Lemaire SRL', '0712.349.984', debtorEmail);

  // 1. Contrat sur le poste « Plomberie » du chantier : 30bis consulté à la création.
  await page.goto(`/chantiers/${projectId}?onglet=sous-traitance`);
  await expect(page.getByRole('heading', { name: 'Contrats de sous-traitance' })).toBeVisible();
  await expect(page.getByText('Aucun sous-traitant sur ce chantier')).toBeVisible();
  await expect(page.getByText('Pas requise a priori')).toBeVisible();
  await page.getByRole('button', { name: 'Nouveau contrat' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Nouveau contrat de sous-traitance' });
  await dialog.getByLabel('Sous-traitant').selectOption({ label: 'Électro Pirson SPRL' });
  await dialog.getByLabel('Poste du chantier').selectOption({ label: 'Plomberie' });
  await dialog.getByLabel('Objet').fill('Raccordements sanitaires');
  await dialog.getByLabel('Montant HTVA').fill('4650');
  await dialog.getByLabel('Versement 2', { exact: true }).fill('Fin de chantier');
  await expect(dialog.getByText('Total : 100 % · 4 650,00 €')).toBeVisible();
  await expectNoA11yViolations(page);
  await dialog.getByRole('button', { name: 'Conclure le contrat' }).click();
  await expect(page.getByText(/Contrat ST\d{4}-001 conclu/)).toBeVisible();
  const drawer = page.getByRole('dialog', { name: /ST\d{4}-001 · Électro Pirson SPRL/ });
  await expect(drawer.getByText('Aucune dette').first()).toBeVisible();
  await expect(drawer.getByText('3 documents à fournir')).toBeVisible();
  await drawer.getByRole('button', { name: 'Envoyer l’accès au portail' }).click();
  await expect(page.getByText(`Accès au portail envoyé à ${pirsonEmail}`)).toBeVisible();
  await drawer.getByRole('button', { name: 'Fermer' }).click();
  // La déclaration de travaux devient probablement requise (un sous-traitant intervient).
  await expect(page.getByText('Probablement requise', { exact: true })).toBeVisible({ timeout: 15_000 });

  // 2. Le sous-traitant ouvre son espace : mission, documents, dépôt de facture.
  const st = await openPortal(browser, pirsonEmail);
  const p = st.page;
  await expect(p.getByRole('heading', { name: 'Bonjour Électro Pirson SPRL' })).toBeVisible();
  await expect(p.getByText('3 documents à fournir ou à renouveler')).toBeVisible();
  await expect(p.getByTestId('portal-mission')).toContainText('Raccordements sanitaires');
  await expectNoA11yViolations(p);
  await p.getByRole('button', { name: 'Déposer : Assurance responsabilité civile' }).click();
  let doc = p.getByRole('dialog', { name: 'Déposer un document' });
  await doc.getByLabel('Valable jusqu’au').fill('2030-12-31');
  await doc.getByLabel('Fichier').setInputFiles(PDF);
  await doc.getByRole('button', { name: 'Envoyer' }).click();
  await expect(p.getByText('2 documents à fournir ou à renouveler')).toBeVisible();
  // Attestation ONSS déjà échue : déposée, mais signalée comme expirée.
  await p.getByRole('button', { name: 'Déposer : Attestation ONSS' }).click();
  doc = p.getByRole('dialog', { name: 'Déposer un document' });
  await doc.getByLabel('Valable jusqu’au').fill('2024-01-31');
  await doc.getByLabel('Fichier').setInputFiles(PDF);
  await doc.getByRole('button', { name: 'Envoyer' }).click();
  await expect(p.getByText('Expiré depuis le 31 janv. 2024')).toBeVisible();

  await p.getByRole('button', { name: 'Déposer une facture' }).click();
  const inv = p.getByRole('dialog', { name: 'Déposer une facture' });
  await inv.getByLabel('Fichier de la facture').setInputFiles({ ...PDF, name: 'facture-12.pdf' });
  await inv.getByLabel('Numéro de la facture').fill('F-2026-12');
  await inv.getByLabel('Montant HTVA').fill('1395');
  await inv.getByRole('button', { name: 'Envoyer la facture' }).click();
  await expect(p.getByText('Facture reçue, merci')).toBeVisible();
  const invoices = p.getByRole('region', { name: 'Vos factures' });
  await expect(invoices).toContainText('F-2026-12');

  // 3. Au bureau : facture imputée au poste du contrat sans saisie, puis mise à payer (30bis).
  const pirsonInvoice = await invoiceOf(page, 'Électro Pirson SPRL', 'allocated');
  expect(pirsonInvoice.matchMethod).toBe('subcontract');
  await page.goto(`/achats/factures?vue=all&facture=${pirsonInvoice.id}`);
  const office = page.getByRole('dialog', { name: 'Électro Pirson SPRL' });
  await expect(office.getByText(/grâce au contrat de sous-traitance/)).toBeVisible();
  await expect(office.getByText(/Consulté à la réception de la facture/)).toBeVisible();
  await office.getByRole('button', { name: 'Valider' }).click();
  await office.getByRole('button', { name: 'Mettre à payer' }).click();
  await expect(office.getByText(/Consulté avant paiement/)).toBeVisible();
  await expect(office.getByText('À payer', { exact: true }).first()).toBeVisible();
  await p.reload();
  await expect(p.getByRole('region', { name: 'Vos factures' })).toContainText('Approuvée, à payer');
  await st.ctx.close();

  // 4. Chemin « dette » : Façades Lemaire, facture bloquée puis retenue appliquée.
  await call(page.request, 'POST', '/subcontracts', {
    id: crypto.randomUUID(),
    projectId,
    supplierId: debtor.id,
    title: 'Rejointoyage des façades',
    amount: 1_840_000,
  });
  await call(page.request, 'POST', `/subcontractors/${debtor.id}/invite`, {});
  const lemaire = await openPortal(browser, debtorEmail);
  await lemaire.page.getByRole('button', { name: 'Déposer une facture' }).click();
  const linv = lemaire.page.getByRole('dialog', { name: 'Déposer une facture' });
  await linv.getByLabel('Fichier de la facture').setInputFiles({ ...PDF, name: 'facture-87.pdf' });
  await linv.getByLabel('Numéro de la facture').fill('2026/087');
  await linv.getByLabel('Montant HTVA').fill('5520');
  await linv.getByRole('button', { name: 'Envoyer la facture' }).click();
  await expect(lemaire.page.getByText('Facture reçue, merci')).toBeVisible();
  await lemaire.ctx.close();

  const lemaireInvoice = await invoiceOf(page, 'Façades Lemaire SRL', 'allocated');
  await page.goto(`/achats/factures?vue=all&facture=${lemaireInvoice.id}`);
  const ldrawer = page.getByRole('dialog', { name: 'Façades Lemaire SRL' });
  await ldrawer.getByRole('button', { name: 'Valider' }).click();
  await ldrawer.getByRole('button', { name: 'Mettre à payer' }).click();
  await expect(ldrawer.getByText('Paiement bloqué')).toBeVisible();
  await expect(ldrawer.getByText('1 932,00 €')).toBeVisible();
  await expect(ldrawer.getByText('3 588,00 €')).toBeVisible();
  await expectNoA11yViolations(page);
  await ldrawer.getByRole('button', { name: 'Appliquer la retenue et mettre à payer' }).click();
  await expect(
    page.getByText('Retenue appliquée : facture à payer, document de versement prêt'),
  ).toBeVisible();
  await expect(ldrawer.getByRole('link', { name: 'Document de versement' })).toBeVisible();
  const transfer = await page.request.get(
    (await ldrawer.getByRole('link', { name: 'Document de versement' }).getAttribute('href'))!,
  );
  expect(transfer.headers()['content-type']).toBe('application/pdf');

  // 5. La liste des sous-traitants montre la conformité et le 30bis.
  await page.goto('/sous-traitance');
  const row = page.getByRole('row', { name: /Électro Pirson SPRL/ });
  await expect(row).toContainText('2 documents à fournir');
  await expect(row).toContainText('Aucune dette');
  await expect(page.getByRole('row', { name: /Façades Lemaire SRL/ })).toContainText('Dette sociale');
});

test('P9 sur téléphone : le sous-traitant consulte sa mission et ses documents @mobile', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await signup(page, { name: 'Sophie Mobile', company: 'Rénov Sous-traitance mobile' });
  const { projectId } = await signedProject(page, uniqueEmail('client-p9m'));
  const email = uniqueEmail('pirson-m');
  const s = await subcontractor(page, 'Électro Pirson SPRL', '0456.789.034', email);
  const contract = await call<{ id: string }>(page.request, 'POST', '/subcontracts', {
    id: crypto.randomUUID(),
    projectId,
    supplierId: s.id,
    title: 'Électricité complète',
    amount: 465_000,
    startDate: '2026-11-02',
    endDate: '2026-11-13',
  });
  await call(page.request, 'POST', `/subcontractors/${s.id}/invite`, { subcontractId: contract.id });
  await page.goto('/sous-traitance');
  await expectNoHorizontalOverflow(page);
  const st = await openPortal(browser, email, true);
  await expect(st.page.getByTestId('portal-mission')).toContainText('Électricité complète');
  await expect(st.page.getByText('3 documents à fournir ou à renouveler')).toBeVisible();
  await expectNoHorizontalOverflow(st.page);
  await expectNoA11yViolations(st.page);
  await st.ctx.close();
});
