import type { Transition, Variants } from "motion/react";

/**
 * 动效预设（文档 6.5）。纪律：只动 transform/opacity/filter；连续值用 useMotionValue；
 * 全局经 MotionConfig reducedMotion="user" 尊重系统减弱动态设置。
 */
const standard: [number, number, number, number] = [0.22, 1, 0.36, 1];
const enter: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const ease = { standard, enter } as const;

export const dur = { instant: 0.12, fast: 0.2, base: 0.32 } as const;

/** 网格入场阶梯间隔（秒） */
export const staggerChildren = 0.024;

export const transition = {
  standard: { duration: dur.base, ease: standard } satisfies Transition,
  fast: { duration: dur.fast, ease: standard } satisfies Transition,
  enter: { duration: dur.base, ease: enter } satisfies Transition,
} as const;

/** 阶段切换后的内容到达：y 8px + opacity */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: transition.enter },
  exit: { opacity: 0, y: -4, transition: transition.fast },
};

/** 网格父容器：子项阶梯入场 */
export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren } },
};

/** 新 Output"显影"：低亮度模糊态 → 清晰（生成完成的状态转换） */
export const develop: Variants = {
  hidden: { opacity: 0, scale: 0.98, filter: "blur(8px) brightness(0.6)" },
  visible: {
    opacity: 1,
    scale: 1,
    filter: "blur(0px) brightness(1)",
    transition: { duration: 0.6, ease: standard },
  },
};
