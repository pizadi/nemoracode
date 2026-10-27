export const available = true

export async function resolveBinary() {
  return process.env.NEMORACODE_PTY_BIN || "nemoracode-pty"
}
