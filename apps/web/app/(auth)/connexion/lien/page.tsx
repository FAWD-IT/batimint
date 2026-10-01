import { Suspense } from 'react';
import { MagicLinkVerify } from './MagicLinkVerify';

export default function MagicLinkPage() {
  return (
    <Suspense>
      <MagicLinkVerify />
    </Suspense>
  );
}
