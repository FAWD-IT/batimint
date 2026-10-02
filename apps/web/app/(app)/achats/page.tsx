import { redirect } from 'next/navigation';
import { getMe } from '@/lib/server-api';

/** Entrée du module Achats : la boîte « À imputer » si l'on traite les factures, sinon les commandes. */
export default async function PurchasingPage() {
  const me = await getMe();
  redirect(me?.permissions.includes('supplier_invoices.read') ? '/achats/factures' : '/achats/commandes');
}
