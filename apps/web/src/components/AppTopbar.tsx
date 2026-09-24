import { Button } from "antd";
import { Aperture, LayoutGrid, LibraryBig, Settings2, Sparkles, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";

import { SettingsDrawer } from "../features/providers/SettingsDrawer";
import { HealthBadge } from "./HealthBadge";
import styles from "./AppTopbar.module.css";

/** 顶栏可标记的页面分区；工作台不在导航项里，它必须携带项目 ID。 */
export type AppTopbarSection = "home" | "forge" | "library" | "models" | "workbench";

/** 全局可达的分区入口，数组顺序即展示顺序。 */
const NAV_SECTIONS: Array<{ section: AppTopbarSection; path: string; label: string; icon: ReactNode }> = [
  { section: "home", path: "/", label: "项目", icon: <LayoutGrid size={16} strokeWidth={1.75} /> },
  { section: "forge", path: "/suite-forge", label: "套图工坊", icon: <Sparkles size={16} strokeWidth={1.75} /> },
  { section: "library", path: "/library", label: "资产库", icon: <LibraryBig size={16} strokeWidth={1.75} /> },
  { section: "models", path: "/models", label: "模特库", icon: <UserRound size={16} strokeWidth={1.75} /> },
];

interface AppTopbarProps {
  current: AppTopbarSection;
  /** 覆盖左侧品牌区；工作台用它承载项目名。 */
  brand?: ReactNode;
  /** 品牌区右侧的页面级控件，例如工作台的侧栏开关。 */
  leftExtra?: ReactNode;
  /** 中列内容；工作台放阶段切换条，它按中列整宽铺开。 */
  center?: ReactNode;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
}

/**
 * 四页共用的顶栏。布局与工作台原顶栏一致（三列网格，中列整宽），
 * 阶段切换条放在中列时铺满整列而不是收成居中小框。
 * 当前页不重复列出自己的入口；设置抽屉挂在这里，页面只保留开关状态。
 */
export function AppTopbar({ current, brand, leftExtra, center, settingsOpen, onSettingsOpenChange }: AppTopbarProps) {
  const navigate = useNavigate();
  const sections = NAV_SECTIONS.filter((item) => item.section !== current);

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        {brand ?? (
          <Link to="/" className={styles.brand}>
            <Aperture size={20} strokeWidth={1.75} aria-hidden />
            <span className={styles.brandName}>EcomGen</span>
          </Link>
        )}
        {leftExtra}
      </div>
      {/* 中列空着也要占位，否则操作区会被网格排到中列。 */}
      <div className={styles.center}>{center}</div>
      <nav className={styles.actions} aria-label="全局导航">
        <HealthBadge />
        {sections.map(({ section, path, label, icon }) => (
          <Button key={section} icon={icon} onClick={() => void navigate(path)}>
            {label}
          </Button>
        ))}
        <Button icon={<Settings2 size={16} strokeWidth={1.75} />} onClick={() => onSettingsOpenChange(true)}>
          设置
        </Button>
      </nav>
      <SettingsDrawer open={settingsOpen} onClose={() => onSettingsOpenChange(false)} />
    </header>
  );
}
