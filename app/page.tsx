import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { EnterpriseProvider } from "@/hooks/useEnterprise";

export default function Home() {
  return (
    <EnterpriseProvider>
      <Suspense>
        <AppShell />
      </Suspense>
    </EnterpriseProvider>
  );
}
