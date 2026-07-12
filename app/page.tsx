import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { EnterpriseProvider } from "@/hooks/useEnterprise";
import { EnterpriseAuthProvider } from "@/hooks/useEnterpriseAuth";

export default function Home() {
  return (
    <EnterpriseAuthProvider>
      <EnterpriseProvider>
        <Suspense>
          <AppShell />
        </Suspense>
      </EnterpriseProvider>
    </EnterpriseAuthProvider>
  );
}
