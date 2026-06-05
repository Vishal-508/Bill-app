import { Outlet } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { selectUI } from '../../store/index.js';
import { cn } from '../../utils/cn.js';
import { useSocket } from '../../hooks/useSocket.js';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import MobileMenu from './MobileMenu.jsx';

/**
 * The frame around every authenticated page. Sidebar is fixed-left on
 * desktop; on mobile (< lg) it's hidden in favour of the slide-over
 * MobileMenu. The main column shifts right by the sidebar's width when
 * the sidebar is open.
 */
export default function MainLayout() {
  const { sidebarOpen } = useSelector(selectUI);
  // Real-time admin notifications (Prompt 10 Section F).
  // Connects on mount, disconnects on unmount (i.e. logout).
  useSocket();
  return (
    <div className="min-h-screen bg-secondary-50">
      <Sidebar />
      <MobileMenu />
      <div className={cn(
        'flex min-h-screen flex-col transition-all duration-200',
        sidebarOpen ? 'lg:ml-60' : 'lg:ml-0',
      )}>
        <Topbar />
        <main className="flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
