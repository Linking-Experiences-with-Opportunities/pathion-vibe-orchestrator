'use client';

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  ShieldCheck,
  BookOpen,
  Rocket,
  Library,
  LogOut,
  PanelLeftClose,
  PanelLeft,
  Menu,
  X,
  Sidebar as SidebarIcon,
  Calendar
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useSessionContext, useSupabaseClient } from '@supabase/auth-helpers-react';
import useCohortStatus from "@/lib/useCohortStatus";
import { useSidebar } from "@/contexts/sidebar-context";
import { useModuleSidebar } from "@/contexts/module-sidebar-context";
import { useNavbarVisibility } from "@/contexts/navbar-visibility-context";
import { getProxiedAvatarUrl } from "@/lib/avatarUtils";
import { clearOfflineCaches } from "@/lib/cacheApiForOffline";

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  description?: string;
  href?: string;
  onClick?: () => void;
  isActive?: boolean;
  collapsed: boolean;
}

const NavItem = ({ icon, label, description, href, onClick, isActive, collapsed }: NavItemProps) => {
  const [showTooltip, setShowTooltip] = useState(false);

  const content = (
    <div
      className={`
        relative flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer
        transition-all duration-200 group
        ${isActive
          ? 'bg-zinc-800 text-white'
          : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
        }
        ${collapsed ? 'justify-center' : ''}
      `}
      onMouseEnter={() => collapsed && setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className="flex-shrink-0 w-5 h-5">
        {icon}
      </div>
      {!collapsed && (
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium truncate">{label}</span>
          {description && (
            <span className="text-xs text-zinc-500 truncate">{description}</span>
          )}
        </div>
      )}

      {/* Tooltip for collapsed state */}
      {collapsed && showTooltip && (
        <div className="absolute left-full ml-2 px-2 py-1 bg-zinc-800 text-white text-sm rounded shadow-lg whitespace-nowrap z-50">
          {label}
        </div>
      )}
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }

  return <button onClick={onClick} className="w-full">{content}</button>;
};

const Navbar = () => {
  const pathname = usePathname();
  const { session, isLoading } = useSessionContext();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileNavRef = useRef<HTMLDivElement>(null);
  const { collapsed, setCollapsed } = useSidebar();
  const { isModuleSidebarOpen, setIsModuleSidebarOpen } = useModuleSidebar();
  const { isNavbarHidden } = useNavbarVisibility();
  const supabase = useSupabaseClient();
  const inCohort = useCohortStatus();

  // Close mobile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (mobileNavRef.current && !mobileNavRef.current.contains(event.target as Node) && isMobileMenuOpen) {
        setIsMobileMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = '';
    };
  }, [isMobileMenuOpen]);

  // Derived values (not hooks)
  const isAdmin = session?.user.email?.includes("@linkedinorleftout.com");
  const isOnModulePage = pathname?.startsWith('/modules/');
  const firstName = session?.user.user_metadata.full_name?.split(' ')[0] ||
                    session?.user.user_metadata.name?.split(' ')[0] ||
                    'User';

  // Hide navbar completely when completion screens are shown
  if (isNavbarHidden) {
    return null;
  }

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const toggleSidebar = () => {
    setCollapsed(!collapsed);
  };

  const NavbarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo Section */}
      <div className={`flex items-center h-16 px-4 border-b border-zinc-800 ${collapsed ? 'justify-center' : ''}`}>
        <Link href="/" className="flex items-center gap-2">
          <Image
            src="/favicon.ico"
            alt="LILO"
            width={38}
            height={38}
            className="rounded-lg"
          />
          {!collapsed && (
            <span className="font-bold text-lg text-white">LILO</span>
          )}
        </Link>
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {isAdmin && (
          <NavItem
            icon={<ShieldCheck className="w-5 h-5" />}
            label="Admin"
            href="/admin"
            isActive={pathname === '/admin' || pathname?.startsWith('/admin/')}
            collapsed={collapsed}
          />
        )}

        {isAdmin && (
          <NavItem
            icon={<BookOpen className="w-5 h-5" />}
            label="Curriculum"
            description="Manage Curriculum Modules"
            href="/modules"
            isActive={pathname === '/modules' || pathname?.startsWith('/modules/')}
            collapsed={collapsed}
          />
        )}

        <NavItem
          icon={<Rocket className="w-5 h-5" />}
          label="Projects"
          description="Your project submissions"
          href="/projects"
          isActive={pathname === '/projects' || pathname?.startsWith('/projects/')}
          collapsed={collapsed}
        />

        <NavItem
          icon={<Calendar className="w-5 h-5" />}
          label="Study Plan"
          description="Schedule your learning"
          href="/study-plan"
          isActive={pathname === '/study-plan'}
          collapsed={collapsed}
        />

        {isAdmin && (
          <NavItem
            icon={<Library className="w-5 h-5" />}
            label="All Modules"
            description="View all modules"
            href="/admin/modules"
            isActive={pathname === '/admin/modules'}
            collapsed={collapsed}
          />
        )}
      </nav>

      {/* User Section */}
      <div className="p-3 border-t border-zinc-800">
        <div className={`
          flex items-center gap-3 p-3 rounded-lg border border-zinc-800 bg-zinc-900/50
          ${collapsed ? 'flex-col' : ''}
        `}>
          <Avatar className="h-9 w-9 flex-shrink-0">
            {session?.user.user_metadata.avatar_url && (
              <AvatarImage 
                src={getProxiedAvatarUrl(session.user.user_metadata.avatar_url, 72)} 
                alt="Profile"
              />
            )}
            <AvatarFallback className="bg-zinc-700 text-zinc-200 text-sm">
              {firstName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{firstName}</p>
              <p className="text-xs text-zinc-500">Student</p>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className={`mt-3 flex gap-2 ${collapsed ? 'flex-col' : ''}`}>
          {/* Module sidebar toggle - only show on module pages */}
          {isOnModulePage && (
            <button
              onClick={() => setIsModuleSidebarOpen(!isModuleSidebarOpen)}
              className={`
                flex items-center justify-center gap-2 px-3 py-2 rounded-lg
                text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50
                transition-colors duration-200
                ${collapsed ? 'w-full' : 'flex-1'}
              `}
              title={isModuleSidebarOpen ? "Hide module sidebar" : "Show module sidebar"}
            >
              <SidebarIcon className="w-4 h-4" />
              {!collapsed && <span className="text-xs">Modules</span>}
            </button>
          )}

          {/* Sign out button */}
          <button
            onClick={async () => {
              // Clear offline caches to prevent stale/wrong user data
              await clearOfflineCaches();
              await supabase.auth.signOut();
            }}
            disabled={isLoading}
            className={`
              flex items-center justify-center gap-2 px-3 py-2 rounded-lg
              text-zinc-400 hover:text-red-400 hover:bg-red-400/10
              transition-colors duration-200
              ${collapsed ? 'w-full' : isOnModulePage ? 'flex-1' : 'w-full'}
              ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}
            `}
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
            {!collapsed && <span className="text-xs">Sign out</span>}
          </button>
        </div>
      </div>

      {/* Collapse Toggle */}
      <div className="p-3 border-t border-zinc-800">
        <button
          onClick={toggleSidebar}
          className="hidden md:flex items-center justify-center w-full gap-2 px-3 py-2 rounded-lg
            text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50
            transition-colors duration-200"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeft className="w-4 h-4" />
          ) : (
            <>
              <PanelLeftClose className="w-4 h-4" />
              <span className="text-xs">Collapse</span>
            </>
          )}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile hamburger menu button */}
      <button
        className="fixed top-4 left-4 z-50 md:hidden bg-zinc-900 text-white p-2 rounded-md shadow-md border border-zinc-800"
        onClick={toggleMobileMenu}
        aria-label="Toggle menu"
      >
        {isMobileMenuOpen ? (
          <X className="h-6 w-6" />
        ) : (
          <Menu className="h-6 w-6" />
        )}
      </button>

      {/* Floating expand button - only visible when collapsed */}
      {collapsed && (
        <button
          className="fixed bottom-4 left-4 z-50 hidden md:flex items-center justify-center
            bg-zinc-900 text-zinc-400 hover:text-white p-3 rounded-full shadow-lg
            border border-zinc-800 hover:bg-zinc-800 transition-all duration-200"
          onClick={toggleSidebar}
          aria-label="Expand sidebar"
        >
          <PanelLeft className="h-5 w-5" />
        </button>
      )}

      {/* Desktop sidebar */}
      <nav
        className={`
          hidden md:flex flex-col bg-[#09090b] h-full border-r border-zinc-800
          transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
          ${collapsed ? 'w-0 overflow-hidden opacity-0' : 'w-64 opacity-100'}
        `}
      >
        <NavbarContent />
      </nav>

      {/* Mobile sidebar overlay */}
      <div
        className={`
          md:hidden fixed inset-0 z-40 bg-black transition-opacity duration-300
          ${isMobileMenuOpen ? 'opacity-50 visible' : 'opacity-0 invisible pointer-events-none'}
        `}
        onClick={() => setIsMobileMenuOpen(false)}
      />

      {/* Mobile sidebar */}
      <div
        ref={mobileNavRef}
        className={`
          md:hidden fixed z-40 inset-y-0 left-0 w-64 bg-[#09090b] h-screen border-r border-zinc-800
          transform transition-transform duration-300 ease-in-out
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <NavbarContent />
      </div>
    </>
  );
};

export default Navbar;
