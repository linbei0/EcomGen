import { theme, type ThemeConfig } from "antd";

/**
 * tokens.css → AntD 主题映射。token 值直接引用 CSS 变量，保证色彩单一事实来源。
 * 定制只走 token + components API，不改 AntD 内部 DOM。
 */
export const antdTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorBgBase: "var(--bg-0)",
    colorBgContainer: "var(--bg-1)",
    colorBgElevated: "var(--bg-2)",
    colorBgLayout: "var(--bg-0)",
    colorBorder: "var(--line-1)",
    colorBorderSecondary: "var(--line-1)",
    colorText: "var(--text-1)",
    colorTextSecondary: "var(--text-2)",
    colorTextTertiary: "var(--text-3)",
    colorPrimary: "var(--accent)",
    colorPrimaryHover: "var(--accent-hover)",
    colorPrimaryActive: "var(--accent-active)",
    colorSuccess: "var(--success)",
    colorWarning: "var(--warning)",
    colorError: "var(--danger)",
    colorInfo: "var(--accent)",
    colorFillAlter: "var(--bg-2)",
    fontSize: 13,
    borderRadius: 8,
    fontFamily:
      "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif",
    fontFamilyCode: "'JetBrains Mono', ui-monospace, Consolas, monospace",
  },
  components: {
    Button: { primaryShadow: "none" },
    Modal: { contentBg: "var(--bg-2)" },
    Drawer: { colorBgElevated: "var(--bg-1)" },
    Upload: { colorFillAlter: "var(--bg-2)" },
    Tabs: { itemSelectedColor: "var(--accent)" },
    Progress: { remainingColor: "var(--bg-3)" },
  },
};
