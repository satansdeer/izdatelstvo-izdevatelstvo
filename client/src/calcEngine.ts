
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
    case "css":
      return "treesitter";
    default:
      return "treesitter";
  }
};
