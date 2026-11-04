import { createContext, useContext, type ReactNode } from 'react';

// React context follows portals, so overlays keep the management interface without
// applying it to the public portal or the customer/waiter/kitchen applications.
const InterfaceScope = createContext(false);
export function ManagementInterfaceProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return <InterfaceScope.Provider value={enabled}>{children}</InterfaceScope.Provider>;
}
export const useManagementInterface = () => useContext(InterfaceScope);
export function useInterfaceSurface() {
  return useManagementInterface() ? 'mesa-erp-surface' : '';
}
