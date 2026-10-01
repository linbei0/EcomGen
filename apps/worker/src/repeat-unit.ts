import sharp from "sharp";

/**
 * 重复单元合成：把基础花型按平铺排列的单元几何拼成一块无缝单元。
 *
 * 环绕补画在加了一圈花型边距的临时画布上完成：每个摆放位以 ±1 单元的九个偏移各画一份，
 * 再从中央裁出单元——伸出单元边界的摆放位（如半落第二列的 dy=0.5）被裁掉的部分恰好由
 * 邻近单元的副本从对侧补回。这一步就是"单元无缝"的全部构造：每条接缝两侧是同一枚花型
 * 的同一条边，因此镜像排列对任意图片无缝（边与它自己的镜像恒等），错位排列的缝则等于
 * 源图自身的缝。
 *
 * 翻转按需缓存：一个单元最多出现原/水平翻/垂直翻/双翻四种变体，重复位共享同一份解码。
 */
export interface RepeatUnitSource {
  data: Buffer;
  width: number;
  height: number;
}

export async function composeRepeatUnit(
  source: RepeatUnitSource,
  unit: { unitWidth: number; unitHeight: number; placements: ReadonlyArray<{ left: number; top: number; flipX: boolean; flipY: boolean }> },
): Promise<Buffer> {
  const variants = new Map<string, Buffer>();
  const variantFor = async (flipX: boolean, flipY: boolean): Promise<Buffer> => {
    const key = `${flipX ? 1 : 0}${flipY ? 1 : 0}`;
    let variant = variants.get(key);
    if (!variant) {
      let pipeline = sharp(source.data);
      if (flipX) pipeline = pipeline.flop();
      if (flipY) pipeline = pipeline.flip();
      variant = await pipeline.png().toBuffer();
      variants.set(key, variant);
    }
    return variant;
  };
  const composites: Array<{ input: Buffer; left: number; top: number }> = [];
  for (const placement of unit.placements) {
    const input = await variantFor(placement.flipX, placement.flipY);
    for (let shiftY = -1; shiftY <= 1; shiftY += 1) {
      for (let shiftX = -1; shiftX <= 1; shiftX += 1) {
        composites.push({
          input,
          left: source.width + placement.left + shiftX * unit.unitWidth,
          top: source.height + placement.top + shiftY * unit.unitHeight,
        });
      }
    }
  }
  // sharp 的管线顺序是 extract 先于 composite（坐标相对裁切后的画布），所以裁切必须
  // 单独跑第二条管线——合成进同一条管线会先裁后画，补画全部落空。
  const margin = await sharp({
    create: {
      width: unit.unitWidth + source.width * 2,
      height: unit.unitHeight + source.height * 2,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
  return sharp(margin)
    .extract({ left: source.width, top: source.height, width: unit.unitWidth, height: unit.unitHeight })
    .png()
    .toBuffer();
}
