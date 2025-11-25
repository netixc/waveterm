// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WOS } from "@/app/store/global";
import { memo, useState } from "react";

const RenameWidgetModal = memo(({ blockOid, currentName }: { blockOid: string; currentName: string }) => {
    const [newName, setNewName] = useState(currentName || "");
    const [error, setError] = useState("");
    const [isRenaming, setIsRenaming] = useState(false);

    const handleRename = async () => {
        const trimmedName = newName.trim();
        if (trimmedName === currentName) {
            modalsModel.popModal();
            return;
        }

        setIsRenaming(true);
        try {
            const oref = WOS.makeORef("block", blockOid);
            await RpcApi.SetMetaCommand(TabRpcClient, {
                oref: oref,
                meta: { "display:name": trimmedName || null },
            });
            modalsModel.popModal();
        } catch (err) {
            console.log("Error renaming widget:", err);
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsRenaming(false);
        }
    };

    const handleClose = () => {
        modalsModel.popModal();
    };

    return (
        <Modal
            className="p-4 min-w-[400px]"
            onOk={handleRename}
            onCancel={handleClose}
            onClose={handleClose}
            okLabel="Rename"
            cancelLabel="Cancel"
            okDisabled={isRenaming}
        >
            <div className="flex flex-col gap-4 mb-4">
                <h2 className="text-xl font-semibold">Rename Widget</h2>
                <div className="flex flex-col gap-2">
                    <input
                        type="text"
                        value={newName}
                        onChange={(e) => {
                            setNewName(e.target.value);
                            setError("");
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.nativeEvent.isComposing && !error) {
                                handleRename();
                            }
                        }}
                        placeholder="Enter widget name (leave empty to clear)"
                        className="px-3 py-2 bg-panel border border-border rounded focus:outline-none focus:border-accent"
                        autoFocus
                        disabled={isRenaming}
                        spellCheck={false}
                    />
                    {error && <div className="text-sm text-error">{error}</div>}
                </div>
            </div>
        </Modal>
    );
});

RenameWidgetModal.displayName = "RenameWidgetModal";

export { RenameWidgetModal };
