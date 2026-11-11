import { titled } from "../../../../../lib/metadata";
import { Suspense } from "react";
import { RecoveryCompleteForm } from "../../../../../components/auth-forms";

export default function Page() {
  return (
    <Suspense>
      <RecoveryCompleteForm />
    </Suspense>
  );
}

export const generateMetadata = titled("auth.recoveryComplete");
