import { Suspense } from 'react';
import { AcceptInvitation } from './AcceptInvitation';

export default function InvitationPage() {
  return (
    <Suspense>
      <AcceptInvitation />
    </Suspense>
  );
}
