export type Errors = Partial<Record<"model" | "credentials" | "form", string>>;

export function describeSaveError(error: unknown): Errors {
  const code =
    error && typeof error === "object" && "code" in error ? error.code : null;
  switch (code) {
    case "SETTINGS_INVALID_MODEL":
      return { model: "此模型不可用，请重新选择。" };
    case "SETTINGS_UNKNOWN_PROVIDER":
      return { credentials: "未识别此供应商，请重新选择。" };
    case "SETTINGS_INVALID_CREDENTIAL":
      return { credentials: "密钥格式无效，请重新输入。" };
    case "SETTINGS_BODY_INVALID":
      return { form: "设置内容无效，请检查后重试。" };
    default:
      return { form: "保存失败，请稍后重试。" };
  }
}
