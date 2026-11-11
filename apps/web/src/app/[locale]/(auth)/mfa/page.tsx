import { titled } from "../../../../lib/metadata";
import { Suspense } from "react";
import { MfaForm } from "../../../../components/auth-forms";

export default function Page() {
  return (
    <Suspense>
      <MfaForm />
    </Suspense>
  );
}

export const generateMetadata = titled("auth.mfa.title");
