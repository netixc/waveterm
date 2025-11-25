// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

type WidgetOpenToolInput struct {
	WidgetType string `json:"widget_type"`
	Url        string `json:"url,omitempty"`
	File       string `json:"file,omitempty"`
	Connection string `json:"connection,omitempty"`
}

func parseWidgetOpenInput(input any) (*WidgetOpenToolInput, error) {
	result := &WidgetOpenToolInput{}

	if input == nil {
		return nil, fmt.Errorf("input is required")
	}

	inputBytes, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal input: %w", err)
	}

	if err := json.Unmarshal(inputBytes, result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal input: %w", err)
	}

	if result.WidgetType == "" {
		return nil, fmt.Errorf("widget_type is required")
	}

	validTypes := map[string]bool{
		"term":    true,
		"web":     true,
		"preview": true,
		"cpuplot": true,
	}

	if !validTypes[result.WidgetType] {
		return nil, fmt.Errorf("invalid widget_type: %s. Valid types are: term, web, preview, cpuplot", result.WidgetType)
	}

	if result.WidgetType == "web" && result.Url == "" {
		return nil, fmt.Errorf("url is required for web widget")
	}

	return result, nil
}

func GetWidgetOpenToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "widget_open",
		DisplayName: "Open Widget",
		Description: "Open a new widget in the current tab. Supported widget types: term (terminal), web (web browser), preview (file preview), cpuplot (CPU graph)",
		ToolLogName: "widget:open",
		Strict:      false,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"widget_type": map[string]any{
					"type":        "string",
					"enum":        []string{"term", "web", "preview", "cpuplot"},
					"description": "Type of widget to open: term (terminal), web (web browser), preview (file preview), cpuplot (CPU graph)",
				},
				"url": map[string]any{
					"type":        "string",
					"description": "URL to open (required for web widget)",
				},
				"file": map[string]any{
					"type":        "string",
					"description": "File path to preview (optional for preview widget)",
				},
				"connection": map[string]any{
					"type":        "string",
					"description": "Connection name for remote widgets (optional)",
				},
			},
			"required":             []string{"widget_type"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			parsed, err := parseWidgetOpenInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			switch parsed.WidgetType {
			case "web":
				return fmt.Sprintf("opening web widget with URL %q", parsed.Url)
			case "preview":
				if parsed.File != "" {
					return fmt.Sprintf("opening preview widget for %q", parsed.File)
				}
				return "opening preview widget"
			case "term":
				if parsed.Connection != "" {
					return fmt.Sprintf("opening terminal connected to %q", parsed.Connection)
				}
				return "opening terminal widget"
			case "cpuplot":
				return "opening CPU graph widget"
			default:
				return fmt.Sprintf("opening %s widget", parsed.WidgetType)
			}
		},
		ToolAnyCallback: func(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			parsed, err := parseWidgetOpenInput(input)
			if err != nil {
				return nil, err
			}

			ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancelFn()
			ctx = waveobj.ContextWithUpdates(ctx)

			meta := map[string]any{
				"view": parsed.WidgetType,
			}

			switch parsed.WidgetType {
			case "web":
				meta["url"] = parsed.Url
			case "preview":
				if parsed.File != "" {
					meta["file"] = parsed.File
				}
			case "term":
				if parsed.Connection != "" {
					meta["connection"] = parsed.Connection
				}
			case "cpuplot":
				if parsed.Connection != "" {
					meta["connection"] = parsed.Connection
				}
			}

			blockDef := &waveobj.BlockDef{
				Meta: meta,
			}

			blockData, err := wcore.CreateBlock(ctx, tabId, blockDef, nil)
			if err != nil {
				return nil, fmt.Errorf("failed to create widget: %w", err)
			}

			layoutAction := waveobj.LayoutActionData{
				ActionType: wcore.LayoutActionDataType_Insert,
				BlockId:    blockData.OID,
				Focused:    true,
			}

			err = wcore.QueueLayoutActionForTab(ctx, tabId, layoutAction)
			if err != nil {
				return nil, fmt.Errorf("failed to add widget to layout: %w", err)
			}

			updates := waveobj.ContextGetUpdatesRtn(ctx)
			wps.Broker.SendUpdateEvents(updates)

			return map[string]any{
				"success":   true,
				"widget_id": blockData.OID[:8],
				"full_id":   blockData.OID,
			}, nil
		},
	}
}

type WidgetCloseToolInput struct {
	WidgetId string `json:"widget_id"`
}

func parseWidgetCloseInput(input any) (*WidgetCloseToolInput, error) {
	result := &WidgetCloseToolInput{}

	if input == nil {
		return nil, fmt.Errorf("input is required")
	}

	inputBytes, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal input: %w", err)
	}

	if err := json.Unmarshal(inputBytes, result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal input: %w", err)
	}

	if result.WidgetId == "" {
		return nil, fmt.Errorf("widget_id is required")
	}

	return result, nil
}

func GetWidgetCloseToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "widget_close",
		DisplayName: "Close Widget",
		Description: "Close a widget by its ID. Use the 8-character widget ID shown in the current tab state.",
		ToolLogName: "widget:close",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"widget_id": map[string]any{
					"type":        "string",
					"description": "8-character widget ID of the widget to close",
				},
			},
			"required":             []string{"widget_id"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			parsed, err := parseWidgetCloseInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("closing widget %s", parsed.WidgetId)
		},
		ToolAnyCallback: func(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			parsed, err := parseWidgetCloseInput(input)
			if err != nil {
				return nil, err
			}

			ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancelFn()
			ctx = waveobj.ContextWithUpdates(ctx)

			fullBlockId, err := wcore.ResolveBlockIdFromPrefix(ctx, tabId, parsed.WidgetId)
			if err != nil {
				return nil, fmt.Errorf("failed to find widget with ID %s: %w", parsed.WidgetId, err)
			}

			// Queue layout action to remove the block from the layout tree
			// This must happen before DeleteBlock so the frontend can properly resize
			layoutAction := waveobj.LayoutActionData{
				ActionType: wcore.LayoutActionDataType_Remove,
				BlockId:    fullBlockId,
			}
			err = wcore.QueueLayoutActionForTab(ctx, tabId, layoutAction)
			if err != nil {
				return nil, fmt.Errorf("failed to queue layout action: %w", err)
			}

			err = wcore.DeleteBlock(ctx, fullBlockId, true)
			if err != nil {
				return nil, fmt.Errorf("failed to close widget: %w", err)
			}

			updates := waveobj.ContextGetUpdatesRtn(ctx)
			wps.Broker.SendUpdateEvents(updates)

			return map[string]any{
				"success": true,
				"message": fmt.Sprintf("widget %s closed", parsed.WidgetId),
			}, nil
		},
	}
}

type WidgetRenameToolInput struct {
	WidgetId string `json:"widget_id"`
	Name     string `json:"name"`
}

func parseWidgetRenameInput(input any) (*WidgetRenameToolInput, error) {
	result := &WidgetRenameToolInput{}

	if input == nil {
		return nil, fmt.Errorf("input is required")
	}

	inputBytes, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal input: %w", err)
	}

	if err := json.Unmarshal(inputBytes, result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal input: %w", err)
	}

	if result.WidgetId == "" {
		return nil, fmt.Errorf("widget_id is required")
	}

	if result.Name == "" {
		return nil, fmt.Errorf("name is required")
	}

	return result, nil
}

func GetWidgetRenameToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "widget_rename",
		DisplayName: "Rename Widget",
		Description: "Set a custom display name for a widget. This makes it easier to identify widgets when multiple are open. The name will appear in brackets in the widget list.",
		ToolLogName: "widget:rename",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"widget_id": map[string]any{
					"type":        "string",
					"description": "8-character widget ID of the widget to rename",
				},
				"name": map[string]any{
					"type":        "string",
					"description": "The new display name for the widget",
				},
			},
			"required":             []string{"widget_id", "name"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			parsed, err := parseWidgetRenameInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("renaming widget %s to %q", parsed.WidgetId, parsed.Name)
		},
		ToolAnyCallback: func(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			parsed, err := parseWidgetRenameInput(input)
			if err != nil {
				return nil, err
			}

			ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancelFn()
			ctx = waveobj.ContextWithUpdates(ctx)

			fullBlockId, err := wcore.ResolveBlockIdFromPrefix(ctx, tabId, parsed.WidgetId)
			if err != nil {
				return nil, fmt.Errorf("failed to find widget with ID %s: %w", parsed.WidgetId, err)
			}

			blockORef := waveobj.MakeORef(waveobj.OType_Block, fullBlockId)
			meta := map[string]any{
				"display:name": parsed.Name,
			}

			err = wstore.UpdateObjectMeta(ctx, blockORef, meta, true)
			if err != nil {
				return nil, fmt.Errorf("failed to rename widget: %w", err)
			}

			wcore.SendWaveObjUpdate(blockORef)

			updates := waveobj.ContextGetUpdatesRtn(ctx)
			wps.Broker.SendUpdateEvents(updates)

			return map[string]any{
				"success": true,
				"message": fmt.Sprintf("widget %s renamed to %q", parsed.WidgetId, parsed.Name),
			}, nil
		},
	}
}

