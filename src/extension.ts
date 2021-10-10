// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { languages, Disposable, Hover, MarkdownString } from "vscode";
import { promisify } from "util";
import { existsSync, readFile } from "fs";
import { exec } from "child_process";
import { resolve } from "path";
import * as cq from "@fullstackio/cq";
const execAsync = promisify(exec);
const readFileAsync = promisify(readFile);

let disposables: Disposable[] = [];

const calcEngine = (ext: string) => {
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

const calcCropQuery = (optionsLine: string, numberOfLines: number) => {
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

const updateFolderIds = async (path: string, diff: number) => {
  const pathArray = path.split("/");
  const folderName = pathArray[pathArray.length - 1];
  const isLesson = folderName.match("lesson_");
  const parentFolder = pathArray.slice(0, -1).join("/");
  const { stdout: parentFolderLs } = await execAsync(`ls -1 ${parentFolder}`);
  const folders = parentFolderLs
    .split("\n")
    .filter((line) =>
      isLesson
        ? /lesson_([0-9]*\.[0-9]*)/.test(line)
        : /([0-9]*\.[0-9]*)-.*/.test(line)
    );
  const folderIndex = folders.indexOf(folderName);

  const affectedFolders =
    diff > 0
      ? folders.slice(folderIndex).reverse()
      : folders.slice(folderIndex);

  for (const affectedFolder of affectedFolders) {
    const folderId = isLesson
      ? affectedFolder.match(/\.([0-9]*)$/)?.[1]
      : affectedFolder.match(/\.([0-9]*)-?/)?.[1];
    const newFolderId = (Number(folderId) + diff).toLocaleString(undefined, {
      minimumIntegerDigits: 2,
    });
    const newFolderName = affectedFolder.replace(
      `.${folderId}`,
      `.${newFolderId}`
    );
    if (existsSync(`${parentFolder}/${newFolderName}`)) {
      vscode.window.showErrorMessage(`${newFolderName} already exists`);
      throw new Error(`${newFolderName} already exists`);
    }
    if (isLesson) {
      const { stdout: lessonFolderContents } = await execAsync(
        `ls -1 ${parentFolder}/${affectedFolder}`
      );
      const lessonFile = `${parentFolder}/${affectedFolder}/${
        lessonFolderContents.split("\n")[0]
      }`;
      try {
        const command = `sed -i '' -e 's/\\.${folderId}-/\.${newFolderId}-/g' ${lessonFile}`;
        await execAsync(command);
      } catch (e) {
        console.log(e);
      }
    }
    await execAsync(
      `mv ${parentFolder}/${affectedFolder} ${parentFolder}/${newFolderName}`
    );
  }
};

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(
    'Congratulations, your extension "mock-publicering" is now active!'
  );

  languages.registerHoverProvider("markdown", {
    async provideHover(document, position, token) {
      const hoveredLine = document.lineAt(position.line).text;
      let optionsLine, pathLine;
      if (hoveredLine?.match(/^<</)) {
        optionsLine = document.lineAt(position.line - 1).text;
        pathLine = document.lineAt(position.line).text;
      } else {
        optionsLine = document.lineAt(position.line).text;
        pathLine = document.lineAt(position.line + 1).text;
      }
      try {
        const filePath = pathLine?.match(/\((.*)\)/)?.[1] || "";
        const extension = filePath.split(".").reverse()[0];
        const fullPath = resolve(document.fileName, "../", filePath);
        const codeString = String(await readFileAsync(fullPath, "utf-8"));
        const numberOfLines = codeString.split("\n").length - 1;

        const { stdout: results } = await execAsync(
          `cq "${calcCropQuery(
            optionsLine,
            numberOfLines
          )}" ${fullPath} --engine=${calcEngine(extension)}`
        );
        return new Hover(
          new MarkdownString(`
\`\`\`tsx
${results}
\`\`\`
			`)
        );
      } catch (e) {
        vscode.window.showErrorMessage((e as Error).message);
        throw e;
      }
    },
  });

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  const incrementStepIds = vscode.commands.registerCommand(
    "mock-publicering.incrementStepIds",
    async (args) => {
      // The code you place here will be executed every time your command is executed
      // Display a message box to the user
      vscode.window.showInformationMessage("Incrementing step ids.");
      const { path } = args;
      await updateFolderIds(path, 1);
    }
  );

  const decrementStepIds = vscode.commands.registerCommand(
    "mock-publicering.decrementStepIds",
    async (args) => {
      // The code you place here will be executed every time your command is executed
      // Display a message box to the user
      vscode.window.showInformationMessage("Decrementing step ids.");
      const { path } = args;
      await updateFolderIds(path, -1);
    }
  );

  context.subscriptions.push(incrementStepIds);
  context.subscriptions.push(decrementStepIds);
}

// this method is called when your extension is deactivated
export function deactivate() {
  if (disposables) {
    disposables.forEach((item) => item.dispose());
  }
  disposables = [];
}
