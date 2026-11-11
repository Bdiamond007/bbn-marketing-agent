import { titled } from "../../../../lib/metadata";
import { Suspense } from "react";
import { RecoveryForm } from "../../../../components/auth-forms";

export default function Page() {
  return (
    <Suspense>
      <RecoveryForm />
    </Suspense>
  );
}

export const generateMetadata = titled("auth.recovery");
