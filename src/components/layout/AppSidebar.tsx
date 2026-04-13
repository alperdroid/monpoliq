import { LayoutDashboard, Calendar, Users, Radio, TrendingUp, BarChart3, MessageSquare, Shield, Grid3X3, Layers, Crosshair, FlaskConical, Bell, Mail, Linkedin } from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import { useLocation } from 'react-router-dom';
import { MonPolLogo } from '@/components/brand/MonPolLogo';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from '@/components/ui/sidebar';

const mainNav = [
  { title: 'Dashboard', url: '/', icon: LayoutDashboard },
  { title: 'Events', url: '/events', icon: Radio },
  { title: 'Speakers', url: '/speakers', icon: Users },
  { title: 'Meeting Cycles', url: '/meetings', icon: Calendar },
  { title: 'Statistical Data', url: '/stats', icon: BarChart3 },
  { title: 'Communications', url: '/comms', icon: MessageSquare },
  { title: 'Predictions', url: '/predictions', icon: TrendingUp },
  { title: 'Empirical Policy', url: '/empirical', icon: FlaskConical },
  { title: 'Topic Heatmaps', url: '/topics', icon: Grid3X3 },
  { title: 'Policy Taxonomy', url: '/taxonomy', icon: Layers },
  { title: 'Policy Radar', url: '/radar', icon: Crosshair },
  { title: 'Committee', url: '/committee', icon: Shield },
  { title: 'Alerts', url: '/alerts', icon: Bell },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const location = useLocation();

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="p-4">
        <MonPolLogo collapsed={collapsed} />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-sidebar-foreground/60">Intelligence</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === '/'}
                      className="hover:bg-sidebar-accent/50 text-sidebar-foreground"
                      activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                    >
                      <item.icon className="w-4 h-4 mr-2 flex-shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3 space-y-2">
        {!collapsed && (
          <>
            <div className="rounded-md bg-sidebar-accent/50 p-2.5">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-data-positive animate-pulse-glow" />
                <span className="text-[10px] text-sidebar-foreground/70 uppercase tracking-wider">Live Feed Active</span>
              </div>
            </div>
            <div className="rounded-md border border-sidebar-border/50 bg-sidebar-accent/30 p-2.5 space-y-2">
              <p className="text-[10px] text-sidebar-foreground/60 font-medium uppercase tracking-wider">Credits</p>
              <div className="space-y-1.5">
                <p className="text-[10px] text-sidebar-foreground/80">Founded by Alper Bastoncu</p>
                <a 
                  href="mailto:alperbastoncu@gmail.com" 
                  className="flex items-center gap-1.5 text-[10px] text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors"
                >
                  <Mail className="w-3 h-3" />
                  alperbastoncu@gmail.com
                </a>
                <a 
                  href="https://linkedin.com/in/alperbastoncu" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-[10px] text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors"
                >
                  <Linkedin className="w-3 h-3" />
                  linkedin.com/alperbastoncu
                </a>
              </div>
            </div>
          </>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
