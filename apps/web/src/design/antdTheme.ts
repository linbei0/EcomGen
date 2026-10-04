import { theme, type ThemeConfig } from "antd";

/**
 * tokens.css → AntD 主题映射。token 值直接引用 CSS 变量，保证色彩单一事实来源。
 * 定制只走 token + components API，不改 AntD 内部 DOM。
 *
 * 一条必须记住的边界：**参与派生的种子色不能写 CSS 变量**。
 * AntD 会拿 colorPrimary 一类种子在 JS 里算出整族派生色（primary-1..10、hover、border、bg、text），
 * 拿到解析不了的 `var(--x)` 时整族会塌成近黑——实测 colorPrimary 变成 `#030303`、primaryBorder 变成
 * `#0e0e0e`、Progress 的填充色也是 `#030303`，于是"已填充"和页面底色几乎同色。
 * 下面各组件的 track/fill 色就是为此逐个写死的（它们只被原样输出，不参与派生，所以可以用变量）。
 * 若要根治全站的主色偏黑，得把种子改成字面量并同步改 tokens.css 的单源约定，那是一处独立决定。
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
    // AntD 需要具体色值来派生危险按钮的 hover/active 色，CSS 变量会被误算为黑色。
    colorError: "#d95f4e",
    colorInfo: "var(--accent)",
    colorFillAlter: "var(--bg-2)",
    fontSize: 13,
    borderRadius: 8,
    fontFamily:
      "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif",
    fontFamilyCode: "'JetBrains Mono', ui-monospace, Consolas, monospace",
  },
  components: {
    Button: { primaryShadow: "none", dangerColor: "#ffffff" },
    Modal: { contentBg: "var(--bg-2)" },
    Drawer: { colorBgElevated: "var(--bg-1)" },
    Menu: {
      dangerItemColor: "var(--danger)",
      dangerItemHoverColor: "var(--danger)",
      dangerItemSelectedColor: "var(--danger)",
      dangerItemActiveBg: "color-mix(in srgb, var(--danger) 18%, var(--bg-2))",
      dangerItemSelectedBg: "color-mix(in srgb, var(--danger) 18%, var(--bg-2))",
    },
    Upload: { colorFillAlter: "var(--bg-2)" },
    Tabs: { itemSelectedColor: "var(--accent)" },
    /*
     * Progress 的填充色默认派生自 colorInfo（上面那条边界说明里的坑），实测落到 #030303，
     * 与页面底色 #0d0d0f 几乎同色——剩下那条 #222227 的槽就成了唯一看得见的东西，
     * "进度"这个唯一的信息反而没了。所以填充色显式给出强调色。
     */
    Progress: { defaultColor: "var(--accent)", remainingColor: "var(--bg-3)" },
    /*
     * 滑杆必须手写轨道两色，不能靠派生。
     *
     * 已覆盖段（trackBg）默认由 colorPrimaryBorder 派生、未覆盖段（railBg）由 colorFillSecondary 派生，
     * 而本主题的 colorPrimary/colorBgBase 是 CSS 变量字符串——AntD 在 JS 里做色值运算时解不开它们，
     * 派生结果会塌到近似同一个暗色（实测 rail = rgba(255,255,255,0.08)、track = #0e0e0e，
     * 而页面底色是 #0d0d0f）。表现出来就是"进度和背景分不清"，两处滑杆（笔径、候选数）一起中招。
     *
     * 所以两段都取固定色值：未覆盖段用 --line-2（为"在任何面上都看得见的界线"而设，能自适应所在的深色面），
     * 已覆盖段与滑块用唯一强调色琥珀——滑杆的"进度"本就该是全屏最明确的一处强调。
     */
    Slider: {
      railBg: "var(--line-2)",
      railHoverBg: "var(--line-2)",
      trackBg: "var(--accent)",
      trackHoverBg: "var(--accent-hover)",
      handleColor: "var(--accent)",
      handleActiveColor: "var(--accent-hover)",
      handleActiveOutlineColor: "var(--accent-subtle)",
      handleColorDisabled: "var(--text-3)",
      trackBgDisabled: "var(--line-2)",
    },
  },
};
