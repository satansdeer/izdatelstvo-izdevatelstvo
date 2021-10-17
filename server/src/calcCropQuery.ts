export const calcCropQuery = (optionsLine: string, numberOfLines: number) => {
  const cropQueryMatch = optionsLine?.match(/crop-query=(.*)}/)?.[1];
  if (cropQueryMatch) {
    return cropQueryMatch;
  }
  const cropStartLine = optionsLine?.match(/crop-start-line=([0-9]*)/)?.[1];
  const cropEndLine = optionsLine?.match(/crop-end-line=([0-9]*)/)?.[1];
  if (cropStartLine && cropEndLine) {
    return `${cropStartLine}-${cropEndLine}`;
  }
  return `1-${numberOfLines}`;
};
