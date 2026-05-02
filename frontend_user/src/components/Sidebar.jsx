import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Activity,
  BarChart3,
  Radar,
  Zap,
} from 'lucide-react';

const NAV_ITEMS = [
  { path: '/', label: 'Command Center', icon: LayoutDashboard },
  { path: '/whales', label: 'Whale Scanner', icon: Users },
  { path: '/alpha', label: 'Alpha Table', icon: BarChart3 },
  { path: '/herd', label: 'Herd Radar', icon: Radar },
  { path: '/activity', label: 'Live Activity', icon: Activity },
  { path: '/signals', label: 'Signal Center', icon: Zap },
];

export default function Sidebar({ isOpen, onClose }) {
  const location = useLocation();

  return (
    <>
      <div className={`mobile-overlay ${isOpen ? 'open' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${isOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-brand">
          <h1>WhaleTrace</h1>
          <div className="brand-sub">Institutional Research Terminal</div>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.path === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.path);

            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={`nav-item ${isActive ? 'active' : ''}`}
                onClick={() => {
                  if (window.innerWidth <= 900) onClose();
                }}
              >
                <Icon className="nav-icon" size={18} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>


      <div className="sidebar-footer">
        <div className="flex items-center gap-2">
          <span className="status-dot" />
          <span className="text-xs text-muted">Data Pipeline Active</span>
        </div>
        <div className="text-xs text-muted mt-2 font-mono" style={{ opacity: 0.5 }}>
          v2.0 — NSE Bulk & Block
        </div>
      </div>
      </aside>
    </>
  );
}
