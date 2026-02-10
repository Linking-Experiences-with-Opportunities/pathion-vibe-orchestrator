"use client";
import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface NavbarVisibilityContextType {
  isNavbarHidden: boolean;
  setNavbarHidden: (hidden: boolean) => void;
}

const NavbarVisibilityContext = createContext<NavbarVisibilityContextType>({
  isNavbarHidden: false,
  setNavbarHidden: () => {},
});

export function NavbarVisibilityProvider({ children }: { children: ReactNode }) {
  const [isNavbarHidden, setNavbarHidden] = useState(false);
  return (
    <NavbarVisibilityContext.Provider value={{ isNavbarHidden, setNavbarHidden }}>
      {children}
    </NavbarVisibilityContext.Provider>
  );
}

export const useNavbarVisibility = () => useContext(NavbarVisibilityContext);

/**
 * Hook that hides the navbar while the component is mounted.
 * Automatically restores navbar visibility on unmount.
 */
export function useHideNavbar() {
  const { setNavbarHidden } = useNavbarVisibility();

  useEffect(() => {
    setNavbarHidden(true);
    return () => setNavbarHidden(false);
  }, [setNavbarHidden]);
}
