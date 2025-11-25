// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AIMessage } from "@/app/aipanel/aimessage";
import { AIToolUseModelProvider } from "@/app/aipanel/aitooluse";
import { WaveUIMessage } from "@/app/aipanel/aitypes";
import { AIDroppedFiles } from "@/app/aipanel/aidroppedfiles";
import {
    formatFileSizeError,
    isAcceptableFile,
    validateFileSize,
    validateFileSizeFromInfo,
} from "@/app/aipanel/ai-utils";
import { atoms, getApi, globalStore, WOS } from "@/store/global";
import { ObjectService } from "@/store/services";
import { cn, fireAndForget, isBlank, base64ToArrayBuffer } from "@/util/util";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { atom, Atom, useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useDrop } from "react-dnd";
import { WaveAIBlockModel } from "./waveai-block-model";
import "./waveai.scss";

// Block-specific messages component
interface BlockMessagesProps {
    messages: WaveUIMessage[];
    status: string;
    model: WaveAIBlockModel;
}

const BlockMessages = memo(({ messages, status, model }: BlockMessagesProps) => {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const prevStatusRef = useRef<string>(status);

    const scrollToBottom = useCallback(() => {
        const container = messagesContainerRef.current;
        if (container) {
            container.scrollTop = container.scrollHeight;
            container.scrollLeft = 0;
        }
    }, []);

    useEffect(() => {
        model.registerScrollToBottom(scrollToBottom);
    }, [model, scrollToBottom]);

    useEffect(() => {
        scrollToBottom();
    }, [messages, scrollToBottom]);

    useEffect(() => {
        const wasStreaming = prevStatusRef.current === "streaming";
        const isNowNotStreaming = status !== "streaming";

        if (wasStreaming && isNowNotStreaming) {
            requestAnimationFrame(() => {
                scrollToBottom();
            });
        }

        prevStatusRef.current = status;
    }, [status, scrollToBottom]);

    return (
        <div ref={messagesContainerRef} className="waveai-messages flex-1 overflow-y-auto p-2 space-y-4">
            {messages.map((message, index) => {
                const isLastMessage = index === messages.length - 1;
                const isStreaming = status === "streaming" && isLastMessage && message.role === "assistant";
                return <AIMessage key={message.id} message={message} isStreaming={isStreaming} />;
            })}

            {status === "streaming" && (messages.length === 0 || messages[messages.length - 1].role !== "assistant") && (
                <AIMessage
                    key="last-message"
                    message={{ role: "assistant", parts: [], id: "last-message" } as any}
                    isStreaming={true}
                />
            )}

            <div ref={messagesEndRef} />
        </div>
    );
});

BlockMessages.displayName = "BlockMessages";

// Block-specific input component
interface BlockInputProps {
    onSubmit: (e: React.FormEvent) => void;
    status: string;
    model: WaveAIBlockModel;
}

const BlockInput = memo(({ onSubmit, status, model }: BlockInputProps) => {
    const input = useAtomValue(model.inputAtom);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const resizeTextarea = useCallback(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        textarea.style.height = "auto";
        const scrollHeight = textarea.scrollHeight;
        const maxHeight = 7 * 24;
        textarea.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
    }, []);

    useEffect(() => {
        const inputRefObject = {
            current: {
                focus: () => textareaRef.current?.focus(),
                resize: resizeTextarea,
                scrollToBottom: () => {
                    const textarea = textareaRef.current;
                    if (textarea) {
                        textarea.scrollTop = textarea.scrollHeight;
                    }
                },
            },
        };
        model.registerInputRef(inputRefObject as any);
    }, [model, resizeTextarea]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const isComposing = e.nativeEvent?.isComposing || e.keyCode == 229;
        if (e.key === "Enter" && !e.shiftKey && !isComposing) {
            e.preventDefault();
            onSubmit(e as any);
        }
    };

    useEffect(() => {
        resizeTextarea();
    }, [input, resizeTextarea]);

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        const acceptableFiles = files.filter(isAcceptableFile);

        for (const file of acceptableFiles) {
            const sizeError = validateFileSize(file);
            if (sizeError) {
                model.setError(formatFileSizeError(sizeError));
                if (e.target) {
                    e.target.value = "";
                }
                return;
            }
            await model.addFile(file);
        }

        if (acceptableFiles.length < files.length) {
            console.warn(`${files.length - acceptableFiles.length} files were rejected due to unsupported file types`);
        }

        if (e.target) {
            e.target.value = "";
        }
    };

    return (
        <div className="waveai-input-container border-t border-gray-600">
            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.txt,.md,.js,.jsx,.ts,.tsx,.go,.py,.java,.c,.cpp,.h,.hpp,.html,.css,.scss,.sass,.json,.xml,.yaml,.yml,.sh,.bat,.sql"
                onChange={handleFileChange}
                className="hidden"
            />
            <form onSubmit={onSubmit}>
                <div className="relative">
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => globalStore.set(model.inputAtom, e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask Wave AI anything..."
                        className="w-full text-white px-2 py-2 pr-5 focus:outline-none resize-none overflow-auto bg-gray-800"
                        style={{ fontSize: "13px" }}
                        rows={2}
                    />
                    <button
                        type="button"
                        onClick={handleUploadClick}
                        className="absolute bottom-6 right-1 w-3.5 h-3.5 transition-colors flex items-center justify-center text-gray-400 hover:text-accent cursor-pointer"
                    >
                        <i className="fa fa-paperclip text-xs"></i>
                    </button>
                    <button
                        type="submit"
                        disabled={status !== "ready" || !input.trim()}
                        className={cn(
                            "absolute bottom-2 right-1 w-3.5 h-3.5 transition-colors flex items-center justify-center",
                            status !== "ready" || !input.trim()
                                ? "text-gray-400"
                                : "text-accent/80 hover:text-accent cursor-pointer"
                        )}
                    >
                        {status === "streaming" ? (
                            <i className="fa fa-spinner fa-spin text-xs"></i>
                        ) : (
                            <i className="fa fa-paper-plane text-xs"></i>
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
});

BlockInput.displayName = "BlockInput";

// Error message component
interface ErrorMessageProps {
    errorMessage: string;
    onClear: () => void;
}

const ErrorMessage = memo(({ errorMessage, onClear }: ErrorMessageProps) => {
    return (
        <div className="px-4 py-2 text-red-400 bg-red-900/20 border-l-4 border-red-500 mx-2 mb-2 relative">
            <button
                onClick={onClear}
                className="absolute top-2 right-2 text-red-400 hover:text-red-300 cursor-pointer z-10"
                aria-label="Close error"
            >
                <i className="fa fa-times text-sm"></i>
            </button>
            <div className="text-sm pr-6 max-h-[100px] overflow-y-auto">{errorMessage}</div>
        </div>
    );
});

ErrorMessage.displayName = "ErrorMessage";

// Welcome message component
const WelcomeMessage = memo(() => {
    return (
        <div className="text-secondary py-8 px-4">
            <div className="text-center">
                <i className="fa fa-sparkles text-4xl text-accent mb-4 block"></i>
                <p className="text-lg font-bold text-primary">Wave AI</p>
            </div>
            <div className="mt-4 text-left max-w-md mx-auto">
                <p className="text-sm mb-4">
                    Wave AI is your terminal assistant with context. It can read your terminal output, analyze widgets,
                    access files, and help you solve problems faster.
                </p>
                <p className="text-sm text-muted">
                    Type a message below to get started.
                </p>
            </div>
        </div>
    );
});

WelcomeMessage.displayName = "WelcomeMessage";

// Drag overlay component
const DragOverlay = memo(() => {
    return (
        <div className="absolute inset-0 bg-accent/20 border-2 border-dashed border-accent rounded-lg flex items-center justify-center z-10 p-4">
            <div className="text-accent text-center">
                <i className="fa fa-upload text-3xl mb-2"></i>
                <div className="text-lg font-semibold">Drop files here</div>
                <div className="text-sm">Images, PDFs, and text/code files supported</div>
            </div>
        </div>
    );
});

DragOverlay.displayName = "DragOverlay";

export class WaveAiModel implements ViewModel {
    viewType: string;
    blockId: string;
    blockAtom: Atom<Block>;
    viewIcon?: Atom<string | IconButtonDecl>;
    viewName?: Atom<string>;
    viewText?: Atom<string | HeaderElem[]>;
    endIconButtons?: Atom<IconButtonDecl[]>;
    aiBlockModel: WaveAIBlockModel;
    presetKey: Atom<string>;
    presetMap: Atom<{ [k: string]: MetaType }>;

    constructor(blockId: string) {
        this.viewType = "waveai";
        this.blockId = blockId;
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.viewIcon = atom("sparkles");
        this.viewName = atom("Wave AI");
        this.aiBlockModel = new WaveAIBlockModel(blockId);

        this.presetKey = atom((get) => {
            const metaPresetKey = get(this.blockAtom).meta["ai:preset"];
            const globalPresetKey = get(atoms.settingsAtom)["ai:preset"];
            return metaPresetKey ?? globalPresetKey;
        });

        this.presetMap = atom((get) => {
            const fullConfig = get(atoms.fullConfigAtom);
            const presets = fullConfig.presets;
            const settings = fullConfig.settings;
            return Object.fromEntries(
                Object.entries(presets)
                    .filter(([k]) => k.startsWith("ai@"))
                    .map(([k, v]) => {
                        const aiPresetKeys = Object.keys(v).filter((k) => k.startsWith("ai:"));
                        const newV = { ...v };
                        newV["display:name"] =
                            aiPresetKeys.length == 1 && aiPresetKeys.includes("ai:*")
                                ? `${newV["display:name"] ?? "Default"} (${settings["ai:model"]})`
                                : newV["display:name"];
                        return [k, newV];
                    })
            );
        });

        this.viewText = atom((get) => {
            const viewTextChildren: HeaderElem[] = [];
            const presets = get(this.presetMap);
            const presetKey = get(this.presetKey);
            const presetName = presets[presetKey]?.["display:name"] ?? "";

            const dropdownItems = Object.entries(presets)
                .sort((a, b) => ((a[1]["display:order"] ?? 0) > (b[1]["display:order"] ?? 0) ? 1 : -1))
                .map(
                    (preset) =>
                        ({
                            label: preset[1]["display:name"],
                            onClick: () =>
                                fireAndForget(() =>
                                    ObjectService.UpdateObjectMeta(WOS.makeORef("block", this.blockId), {
                                        "ai:preset": preset[0],
                                    })
                                ),
                        }) as MenuItem
                );
            dropdownItems.push({
                label: "Add AI preset...",
                onClick: () => {
                    fireAndForget(async () => {
                        const path = `${getApi().getConfigDir()}/presets/ai.json`;
                        const blockDef: BlockDef = {
                            meta: {
                                view: "preview",
                                file: path,
                            },
                        };
                        const { createBlock } = await import("@/store/global");
                        await createBlock(blockDef, false, true);
                    });
                },
            });
            viewTextChildren.push({
                elemtype: "menubutton",
                text: presetName,
                title: "Select AI Configuration",
                items: dropdownItems,
            });
            return viewTextChildren;
        });

        this.endIconButtons = atom((_) => {
            let clearButton: IconButtonDecl = {
                elemtype: "iconbutton",
                icon: "delete-left",
                title: "Clear Chat History",
                click: () => this.aiBlockModel.clearChat(),
            };
            return [clearButton];
        });
    }

    get viewComponent(): ViewComponent {
        return WaveAi;
    }

    dispose() {
        // Cleanup if needed
    }

    giveFocus(): boolean {
        this.aiBlockModel.focusInput();
        return true;
    }
}

const WaveAi = ({ model }: { model: WaveAiModel; blockId: string }) => {
    const [isDragOver, setIsDragOver] = useState(false);
    const [isReactDndDragOver, setIsReactDndDragOver] = useState(false);
    const [initialLoadDone, setInitialLoadDone] = useState(false);
    const aiModel = model.aiBlockModel;
    const containerRef = useRef<HTMLDivElement>(null);
    const errorMessage = useAtomValue(aiModel.errorMessage);

    const { messages, sendMessage, status, setMessages, error, stop } = useChat({
        transport: new DefaultChatTransport({
            api: aiModel.getUseChatEndpointUrl(),
            prepareSendMessagesRequest: (opts) => {
                const msg = aiModel.getAndClearMessage();
                const body: any = {
                    msg,
                    chatid: globalStore.get(aiModel.chatId),
                    widgetaccess: globalStore.get(aiModel.widgetAccessAtom),
                    tabid: globalStore.get(atoms.staticTabId),
                };
                return { body };
            },
        }),
        onError: (error) => {
            console.error("AI Chat error:", error);
            aiModel.setError(error.message || "An error occurred");
        },
    });

    aiModel.registerUseChatData(sendMessage, setMessages, status, stop);

    useEffect(() => {
        globalStore.set(aiModel.isAIStreaming, status == "streaming");
    }, [status, aiModel]);

    useEffect(() => {
        const loadChat = async () => {
            await aiModel.uiLoadInitialChat();
            setInitialLoadDone(true);
        };
        loadChat();
    }, [aiModel]);

    useEffect(() => {
        const updateWidth = () => {
            if (containerRef.current) {
                globalStore.set(aiModel.containerWidth, containerRef.current.offsetWidth);
            }
        };

        updateWidth();

        const resizeObserver = new ResizeObserver(updateWidth);
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        return () => {
            resizeObserver.disconnect();
        };
    }, [aiModel]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await aiModel.handleSubmit();
        setTimeout(() => {
            aiModel.focusInput();
        }, 100);
    };

    const hasFilesDragged = (dataTransfer: DataTransfer): boolean => {
        return dataTransfer.types.includes("Files");
    };

    const handleDragOver = (e: React.DragEvent) => {
        const hasFiles = hasFilesDragged(e.dataTransfer);
        if (!hasFiles) return;

        e.preventDefault();
        e.stopPropagation();

        if (!isDragOver) {
            setIsDragOver(true);
        }
    };

    const handleDragEnter = (e: React.DragEvent) => {
        const hasFiles = hasFilesDragged(e.dataTransfer);
        if (!hasFiles) return;

        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        const hasFiles = hasFilesDragged(e.dataTransfer);
        if (!hasFiles) return;

        e.preventDefault();
        e.stopPropagation();

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;

        if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
            setIsDragOver(false);
        }
    };

    const handleDrop = async (e: React.DragEvent) => {
        if (!e.dataTransfer.files.length) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        const files = Array.from(e.dataTransfer.files);
        const acceptableFiles = files.filter(isAcceptableFile);

        for (const file of acceptableFiles) {
            const sizeError = validateFileSize(file);
            if (sizeError) {
                aiModel.setError(formatFileSizeError(sizeError));
                return;
            }
            await aiModel.addFile(file);
        }

        if (acceptableFiles.length < files.length) {
            const rejectedCount = files.length - acceptableFiles.length;
            const rejectedFiles = files.filter((f) => !isAcceptableFile(f));
            const fileNames = rejectedFiles.map((f) => f.name).join(", ");
            aiModel.setError(
                `${rejectedCount} file${rejectedCount > 1 ? "s" : ""} rejected (unsupported type): ${fileNames}. Supported: images, PDFs, and text/code files.`
            );
        }
    };

    const handleFileItemDrop = useCallback(
        (draggedFile: DraggedFile) => aiModel.addFileFromRemoteUri(draggedFile),
        [aiModel]
    );

    const [{ isOver, canDrop }, drop] = useDrop(
        () => ({
            accept: "FILE_ITEM",
            drop: handleFileItemDrop,
            collect: (monitor) => ({
                isOver: monitor.isOver(),
                canDrop: monitor.canDrop(),
            }),
        }),
        [handleFileItemDrop]
    );

    useEffect(() => {
        if (isOver && canDrop) {
            setIsReactDndDragOver(true);
        } else {
            setIsReactDndDragOver(false);
        }
    }, [isOver, canDrop]);

    useEffect(() => {
        if (containerRef.current) {
            drop(containerRef.current);
        }
    }, [drop]);

    return (
        <AIToolUseModelProvider value={aiModel}>
            <div
                ref={containerRef}
                className={cn(
                    "waveai @container bg-gray-900 flex flex-col h-full relative",
                    (isDragOver || isReactDndDragOver) && "bg-gray-800 border-accent"
                )}
                onDragOver={handleDragOver}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                {(isDragOver || isReactDndDragOver) && <DragOverlay />}

                <div className="flex-1 flex flex-col min-h-0">
                    {messages.length === 0 && initialLoadDone ? (
                        <div className="flex-1 overflow-y-auto p-2">
                            <WelcomeMessage />
                        </div>
                    ) : (
                        <BlockMessages messages={messages as WaveUIMessage[]} status={status} model={aiModel} />
                    )}
                    {errorMessage && <ErrorMessage errorMessage={errorMessage} onClear={() => aiModel.clearError()} />}
                    <AIDroppedFiles model={aiModel as any} />
                    <BlockInput onSubmit={handleSubmit} status={status} model={aiModel} />
                </div>
            </div>
        </AIToolUseModelProvider>
    );
};

export { WaveAi };
