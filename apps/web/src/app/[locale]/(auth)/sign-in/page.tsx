import { titled } from "../../../../lib/metadata";
import { Suspense } from "react";
import { SignInForm } from "../../../../components/auth-forms";

export default function Page() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}

export const generateMetadata = titled("auth.signIn");
