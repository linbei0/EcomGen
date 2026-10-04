import { useState } from "react";
import { Button, Space } from "antd";
import { Wand2 } from "lucide-react";
import { ReferenceTextArea, type ReferenceOption } from "./ReferenceTextArea";
import styles from "./DraftEditPanel.module.css";

/**
 * 改稿的说明。
 *
 * 说明必须由用户写：此前改稿的说明曾被写死成一句空话，模型拿到一张标注却不知道要改成什么，
 * 只能自己猜。所以这里不给默认值，没写就提交不了，而不是替用户编一句话。
 *
 * 画与不画是同一个操作的两条路，区别只有"画没画笔迹"：画了就是按笔迹改，没画就是整图改。
 * 两条路的承诺不同，所以那句话也跟着有没有笔迹切换——状态与它对应的说法贴在一起，
 * 用户不用自己去推"我现在这句话算不算数"。说明与控件的距离，就是用户要把它们对上号的距离。
 */
export function DraftEditPanel({ references, annotated, busy, onSubmit, onCancel }: {
  references: ReferenceOption[];
  /** 画布上已经画出笔迹；没画就是对整张图改稿。 */
  annotated: boolean;
  busy: boolean;
  onSubmit: (instruction: string) => void;
  onCancel: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  return (
    <Space orientation="vertical" size="small" style={{ width: "100%" }}>
      <ReferenceTextArea
        references={references}
        rows={2}
        value={instruction}
        onChange={setInstruction}
        placeholder="描述要怎么改，比如：把这朵花的花心换成粉色"
        ariaLabel="改稿说明"
      />
      <span className={styles.note}># 插入颜色，@ 引用参考图</span>
      <Space size="small" wrap>
        <Button
          size="small"
          type="primary"
          icon={<Wand2 size={13} />}
          loading={busy}
          disabled={!instruction.trim()}
          onClick={() => onSubmit(instruction.trim())}
        >
          提交改稿
        </Button>
        <Button size="small" onClick={onCancel}>取消</Button>
        {annotated
          ? <span className={styles.note}>笔迹只用来指明要改哪里，不会出现在结果里</span>
          : <span className={styles.note}>不画笔迹：只按说明改整张图</span>}
      </Space>
    </Space>
  );
}
