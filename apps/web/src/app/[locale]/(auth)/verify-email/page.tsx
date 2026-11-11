import { titled } from "../../../../lib/metadata";
import { Suspense } from "react";
import { VerifyEmailForm } from "../../../../components/auth-forms";

export default function Page() {
  return (
    <Suspense>
      <VerifyEmailForm />
    </Suspense>
  );
}

export const generateMetadata = titled("auth.verifyEmail");
