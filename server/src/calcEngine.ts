
export const calcEngine = (ext: string) => {
  switch (ext) {
    case "tsx":
      return "typescript";
    case "ts":
      return "typescript";
    case "js":
      return "babylon";
    case "jsx":
      return "babylon";
    case "json":
      return "treesitter";
    default:
      return "auto";
  }
};
