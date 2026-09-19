/**
 * 跨应用共享的容量与范围约束。
 *
 * API 校验、TypeBox 契约与前端表单必须引用同一份数值，否则双端硬编码会各自漂移
 * （改一侧忘另一侧，用户要等到上传失败才发现限制变了）。
 *
 * 单独成文件而非并入 index 常量区，是因为 api-requests 需要引用这些值构造 schema，
 * 而 index 又需要转发 api-requests，同文件会形成循环导入。
 */

/** 套图反推单次可上传的源图张数上限。 */
export const MAX_SUITE_FORGE_SOURCES = 12;

/** 套图反推目标分镜数的下限：低于该值无法覆盖完整的转化漏斗。 */
export const MIN_SUITE_FORGE_SHOTS = 5;

/** 套图反推目标分镜数的上限，同时是 EcomSuiteFile.shots 的容量上限。 */
export const MAX_SUITE_FORGE_SHOTS = 12;

/** 单个上传文件的体积上限（字节）。 */
export const MAX_UPLOAD_FILE_BYTES = 30 * 1024 * 1024;

/** 套图名称长度上限；multipart 字段没有 schema 校验，API 需按同一数值自行约束。 */
export const MAX_SUITE_FORGE_NAME_LENGTH = 60;

/** 额外反推要求长度上限；同上，避免前端已截断、后端却静默接受超长输入。 */
export const MAX_SUITE_FORGE_INSTRUCTION_LENGTH = 4000;
