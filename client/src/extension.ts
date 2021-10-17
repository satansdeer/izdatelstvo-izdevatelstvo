// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as path from "path";
import { languages, Disposable, Hover, MarkdownString } from "vscode";
import { existsSync, readFile } from "fs";
import { resolve } from "path";
import { promisify } from "util";
import { exec } from "child_process";
const execAsync = promisify(exec);
const readFileAsync = promisify(readFile);
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import { calcCropQuery } from './calcCropQuery';
import { calcEngine } from './calcEngine';
// import { calcCropQuery } from '../../shared';

let disposables: Disposable[] = [];

let client: LanguageClient;

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
      vscode.window.showInformationMessage("Incrementing step ids.");
      const { path } = args;
      await updateFolderIds(path, 1);
    }
  );

  const decrementStepIds = vscode.commands.registerCommand(
    "mock-publicering.decrementStepIds",
    async (args) => {
      vscode.window.showInformationMessage("Decrementing step ids.");
      const { path } = args;
      await updateFolderIds(path, -1);
    }
  );

  const verifyDiff = vscode.commands.registerCommand(
    "mock-publicering.verifyDiff",
    async (args) => {
      vscode.window.showInformationMessage("Verifying diff.");
      const currentDocument =
        vscode?.window?.activeTextEditor?.document.uri.fsPath;
      const lessonId = currentDocument?.match(/lesson_([0-9]*\.[0-9]*)\//)?.[1];
      console.log(lessonId);
    }
  );

  const serverModule = context.asAbsolutePath(
    path.join("server", "out", "server.js")
  );
  const debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions,
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "markdown" }],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher("**/**/.md"),
    },
  };

  client = new LanguageClient(
    "languageServerExample",
    "Language Server Example",
    serverOptions,
    clientOptions
  );


  // Start the client. This will also launch the server
  client.start();

  context.subscriptions.push(verifyDiff);
  context.subscriptions.push(incrementStepIds);
  context.subscriptions.push(decrementStepIds);
}

// this method is called when your extension is deactivated
export function deactivate() {
  if (disposables) {
    disposables.forEach((item) => item.dispose());
  }
  disposables = [];
  if (!client) {
    return undefined;
  }
  return client.stop();
}
