import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  TextDocumentSyncKind,
  InitializeResult,
} from "vscode-languageserver/node";
import { resolve } from "path";
import { promisify } from "util";
import { exec } from "child_process";
import { readFile } from "fs";
const execAsync = promisify(exec);
const readFileAsync = promisify(readFile);

import { TextDocument } from "vscode-languageserver-textdocument";
import { calcCropQuery } from "./calcCropQuery";
import { calcEngine } from "./calcEngine";

const findIgnoredFiles = (text: string) => {
  const matches = text.match(/\{ignore=.*\}/g);
  const ignoredFiles =
    matches
      ?.map((match) => {
        return match.split("=")[1].replace("}", "");
      })
      .filter(Boolean) || [];
  return ignoredFiles;
};

const findCq = async (text: string, documentPath: string) => {
  const matches = text.match(/(^|\n)\{.*(\n|\r|\r\n)<<.*\)/g);
  const brokenDownMatches = matches?.reduce((acc: string[], match: string) => {
    const cropQueryMatch = match?.match(/crop-query=\((.*)\)}/)?.[1];
    if (!cropQueryMatch) {
      return [...acc, match];
    }
    const cropQueryByComma = cropQueryMatch?.split(",");
    const partialMatches = cropQueryByComma?.map((cropQueryPartMatch: string) =>
      match.replace(cropQueryMatch, cropQueryPartMatch)
    );
    return [...acc, ...partialMatches];
  }, []);
  const cqChunks = await Promise.all(
    brokenDownMatches?.map(async (codeQueryBlock) => {
      const filePath = codeQueryBlock?.match(/\]\((.*)\)/)?.[1] || "";
      const fullPath = resolve(documentPath, "../", filePath);
      const cropStartLine = Number(
        codeQueryBlock?.match(/crop-start-line=([0-9]*)/)?.[1]
      );
      const cropEndLine = Number(
        codeQueryBlock?.match(/crop-end-line=([0-9]*)/)?.[1]
      );
      if (cropStartLine && cropEndLine) {
        const lines = Array.from(
          { length: cropEndLine - cropStartLine + 1 },
          (_, i) => i + cropStartLine
        );
        return { lines, filePath: fullPath };
      }
      if (codeQueryBlock.match(/crop-query=([0-9\-]*)/g)) {
        const lineRange = codeQueryBlock.split("-").map(Number);
        const lines = Array.from(
          { length: lineRange[1] - lineRange[0] + 1 },
          (_, i) => i + lineRange[0]
        );
        return { lines, filePath: fullPath };
      }
      const codeString = String(await readFileAsync(fullPath, "utf-8"));
      const numberOfLines = codeString.split("\n").length - 1;
      if (!codeQueryBlock.match(/crop-query=/g)) {
        const lineRange = [1, numberOfLines];
        const lines = Array.from(
          { length: lineRange[1] - lineRange[0] + 1 },
          (_, i) => i + lineRange[0]
        );
        return { lines, filePath: fullPath };
			}
      const match = codeQueryBlock.match(/(\{.*\})/) || [];
      const extension = filePath.split(".").reverse()[0];
      const command = `cq "${calcCropQuery(
        match[1],
        numberOfLines
      )}" ${fullPath} --engine=${calcEngine(extension)} --json`;
      const { stdout: results } = await execAsync(command);
      if (!results) {
        return undefined;
      }
      const data: any = JSON.parse(results);
      const lineRange = [data.start_line, data.end_line];
      const lines = Array.from(
        { length: lineRange[1] - lineRange[0] + 1 },
        (_, i) => i + lineRange[0]
      );
      return { lines, filePath: fullPath };
    }) || []
  );
  return cqChunks.filter(Boolean).reduce((acc: any, chunk: any) => {
    return {
      ...acc,
      [chunk.filePath]: [...(acc[chunk.filePath] || []), ...chunk.lines],
    };
  }, {});
};

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;

  // Does the client support the `workspace/configuration` request?
  // If not, we fall back using global settings.
  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
    },
  };
  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }
  return result;
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    // Register for all configuration changes.
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined
    );
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders((_event) => {
      connection.console.log("Workspace folder change event received.");
    });
  }
});

// The example settings
interface ExampleSettings {
  maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000 };
let globalSettings: ExampleSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

connection.onDidChangeConfiguration((change) => {
  if (hasConfigurationCapability) {
    // Reset all cached document settings
    documentSettings.clear();
  } else {
    globalSettings = <ExampleSettings>(
      (change.settings.izdatelstvoIzdevatelstvoSettings || defaultSettings)
    );
  }

  // Revalidate all open text documents
  documents.all().forEach(validateTextDocument);
});

// Only keep settings for open documents
documents.onDidClose((e) => {
  documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
// documents.onDidChangeContent(change => {
// 	validateTextDocument(change.document);
// });

documents.onDidSave((change) => {
  validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  const diagnostics: Diagnostic[] = [];

  const lessonId = textDocument.uri.match(/lesson_([0-9]*\.[0-9]*)/)?.[1];
  const moduleId = textDocument.uri.match(/module_([0-9]*)/)?.[1];

  const documentPath = textDocument.uri.replace("file://", "");

  const relatedCodePath = resolve(documentPath, "../", "../", "../", "code");
  const { stdout: codeFolderContents } = await execAsync(
    `ls ${relatedCodePath}`
  );
  const selectedChapter = codeFolderContents.split("\n").find((folder) => {
    return folder.includes(String(moduleId));
  });

  const codeLessonsParentFolder = `${relatedCodePath}/${selectedChapter}`;

  const { stdout: codeLessonFolders } = await execAsync(
    `ls ${codeLessonsParentFolder}`
  );

  const codeLessonFoldersArray = codeLessonFolders.split("\n");
  let selectedLessonIndex;
  const selectedLesson = codeLessonFoldersArray.find((folder, index) => {
    if (folder.includes(String(lessonId))) {
      selectedLessonIndex = index;
      return true;
    }
    return false;
  });
  if (!selectedLesson) {
    connection.window.showErrorMessage("No linked code example.");
    return;
  }
  const comparisonLesson = !!selectedLessonIndex
    ? codeLessonFoldersArray[selectedLessonIndex - 1]
    : undefined;

  if (!comparisonLesson) {
    connection.window.showErrorMessage("No comparison code example.");
    return;
  }
  try {
    const { stdout: diffStr } = await execAsync(
      `diff-jsonify ${codeLessonsParentFolder}/${comparisonLesson} ${codeLessonsParentFolder}/${selectedLesson}`
    );
    const diff = JSON.parse(diffStr) as any;
    const cqChunks: any = await findCq(
      (textDocument as any)._content,
      documentPath
    );
    const ignoredFiles = findIgnoredFiles((textDocument as any)._content);
    for (const [file, changes] of Object.entries(diff)) {
      const unmentionedChanges = (changes as any[])
        .map((change) => {
          const fileChunks = cqChunks[file];
          if (ignoredFiles.some((ignoredFile) => file.includes(ignoredFile))) {
            return undefined;
          }
          if (!fileChunks) {
            return change;
          }
          if (fileChunks.includes(change.ln)) {
            return undefined;
          }
          if (change.content === "+" || change.content === "-") {
            return undefined;
          }
          return change;
        })
        .filter(Boolean);

      const containsAdditions = unmentionedChanges.reduce((acc, change) => {
        if (change.type === "add") {
          return true;
        }
        return acc;
      }, false);

      const currentLesson = file.includes(selectedLesson)
        ? selectedLesson
        : comparisonLesson;

      if ((unmentionedChanges as any).length) {
        const diagnostic: Diagnostic = {
          severity: containsAdditions
            ? DiagnosticSeverity.Error
            : DiagnosticSeverity.Warning,
          range: {
            start: textDocument.positionAt(0),
            end: textDocument.positionAt(0),
          },
          message: `Missed change: ${currentLesson}${
            file.replace(currentLesson, "#").split("#")[1]
          }`,
          source: "Izdatelstvo Izdevatelstvo",
        };
        if (hasDiagnosticRelatedInformationCapability) {
          diagnostic.relatedInformation = [];
          for (const change of unmentionedChanges as any[]) {
            diagnostic.relatedInformation.push({
              location: {
                uri: file,
                range: {
                  start: { line: change.ln - 1, character: 0 },
                  end: { line: change.ln - 1, character: 0 },
                },
              },
              message: (change as any).content,
            });
          }
        }
        diagnostics.push(diagnostic);
      }
    }
    ignoredFiles.forEach((file) => {
      diagnostics.push({
        severity: DiagnosticSeverity.Information,
        range: {
          start: textDocument.positionAt(0),
          end: textDocument.positionAt(0),
        },
        message: `You've ignored ${file}`,
        source: "Izdatelstvo Izdevatelstvo",
      });
    });
  } catch (e) {
    connection.window.showErrorMessage((e as Error).message);
  }
  const diagnostic: Diagnostic = {
    severity: DiagnosticSeverity.Information,
    range: {
      start: textDocument.positionAt(0),
      end: textDocument.positionAt(0),
    },
    message: `File checked ${new Date().toLocaleTimeString()}`,
    source: "Izdatelstvo Izdevatelstvo",
  };
  diagnostics.push(diagnostic);
  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

// connection.onDidChangeWatchedFiles(_change => {
// 	// Monitored files have change in VSCode
// 	connection.console.log('We received an file change event');
// });

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
