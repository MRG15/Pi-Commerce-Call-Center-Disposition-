'use client';
import { usePathname } from 'next/navigation';
import {
  AlarmClock, BadgeCheck, BarChart3, Circle, CircleX, FolderOpen, HeartHandshake, Hourglass, House, Inbox, IndianRupee,
  LineChart, ListChecks, ListTodo, LogOut, Megaphone, NotebookPen, PhoneCall, PhoneIncoming, Rocket, ShieldCheck, Shuffle, Store, Wrench,
} from 'lucide-react';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarInset, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';

// Icon per view key, shared across workspaces.
const VIEW_ICONS: Record<string, React.ReactNode> = {
  home: <House />, leads: <ListChecks />, leadgen: <Megaphone />, reqcb: <PhoneIncoming />,
  new: <Inbox />, callbacks: <PhoneCall />, overdue: <AlarmClock />, technical: <Wrench />, ageing: <Hourglass />,
  all: <FolderOpen />, ads_live: <BadgeCheck />, lost: <CircleX />,
  queues: <ListTodo />, metrics: <LineChart />, notes: <NotebookPen />, allocation: <Shuffle />,
  seller: <Store />, onboarding: <Rocket />, customer_success: <HeartHandshake />, incentives: <IndianRupee />,
};

export type ShellView = { key: string; label: string; active?: boolean; onClick: () => void; badge?: number | string; className?: string; icon?: React.ReactNode };

// One shell for every workspace: left nav (workspace links + the page's own views), slim top bar (title + filters/actions).
export default function AppShell({ user, title, views, viewsLabel = 'Views', actions, children }: {
  user: any; title: string; views?: ShellView[]; viewsLabel?: string; actions?: React.ReactNode; children: React.ReactNode;
}) {
  const path = usePathname();
  const a = user?.access || {}, su = !!user?.isSuperAdmin;
  const links = [
    { href: '/', label: 'Seller', icon: <Store />, show: su || a.seller },
    { href: '/onboarding', label: 'Onboarding', icon: <Rocket />, show: su || a.onboarding },
    { href: '/csm', label: 'CSM', icon: <HeartHandshake />, show: su || a.csm },
    { href: '/analytics', label: 'Analytics', icon: <BarChart3 />, show: su || a.seller === 'admin' || a.onboarding === 'admin' || a.onboarding === 'customer_success' || a.incentives },
    { href: '/admin/access', label: 'Manage Access', icon: <ShieldCheck />, show: su || a.seller === 'admin' || a.onboarding === 'admin' },
  ].filter(l => l.show);
  const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }); location.replace('/login'); };
  const initials = String(user?.name || '?').split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();

  return <SidebarProvider>
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu><SidebarMenuItem>
          <SidebarMenuButton size="lg" render={<a href="/" />}>
            <img src="/pi-logo.jpg" alt="Pi" className="size-8 shrink-0 rounded-lg" />
          </SidebarMenuButton>
        </SidebarMenuItem></SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {!!views?.length && <SidebarGroup>
          <SidebarGroupLabel>{viewsLabel}</SidebarGroupLabel>
          <SidebarGroupContent><SidebarMenu>
            {views.map(v => <SidebarMenuItem key={v.key}>
              <SidebarMenuButton isActive={v.active} tooltip={v.label} onClick={v.onClick} className={v.className}>
                {v.icon ?? VIEW_ICONS[v.key] ?? <Circle />}
                <span>{v.label}</span>
              </SidebarMenuButton>
              {v.badge ? <SidebarMenuBadge>{v.badge}</SidebarMenuBadge> : null}
            </SidebarMenuItem>)}
          </SidebarMenu></SidebarGroupContent>
        </SidebarGroup>}
        {links.length > 1 && <SidebarGroup>
          <SidebarGroupLabel>Workspaces</SidebarGroupLabel>
          <SidebarGroupContent><SidebarMenu>
            {links.map(l => <SidebarMenuItem key={l.href}>
              <SidebarMenuButton isActive={l.href === '/' ? path === '/' : path.startsWith(l.href)} tooltip={l.label} render={<a href={l.href} />}>
                {l.icon}<span>{l.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>)}
          </SidebarMenu></SidebarGroupContent>
        </SidebarGroup>}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip={user?.name}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold">{initials}</div>
              <div className="grid flex-1 text-left leading-tight"><span className="truncate font-medium">{user?.name}</span><span className="truncate text-xs text-muted-foreground">{su ? 'Super Admin' : user?.role || ''}</span></div>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Logout" onClick={logout}><LogOut /><span>Logout</span></SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
    <SidebarInset className="min-w-0 bg-[#f5f7fb]">
      <header className="sticky top-0 z-20 flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-white/95 px-4 py-2 backdrop-blur">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="h-5" />
        <h1 className="m-0 text-[15px] font-semibold text-[#002970]">{title}</h1>
        {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="app-shell">{children}</div>
    </SidebarInset>
  </SidebarProvider>;
}
