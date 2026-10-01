import { Skeleton } from '@batimint/ui';

export default function Loading() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6" aria-busy="true">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
