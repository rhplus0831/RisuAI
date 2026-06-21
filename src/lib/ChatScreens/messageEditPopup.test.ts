import { describe, expect, it } from 'vitest'

import {
  MESSAGE_EDIT_POPUP_LENGTH_THRESHOLD,
  shouldAutoPopupMessageEditor,
  shouldAutoPopupTranslationEditor,
  shouldUseStableMessageEditor,
} from './messageEditPopup'

describe('shouldAutoPopupMessageEditor', () => {
  it('auto-opens the popup editor for message edits by default', () => {
    expect(
      shouldAutoPopupMessageEditor({
        editMode: true,
        index: 0,
      }),
    ).toBe(true)
  })

  it('honors the accessibility opt-out', () => {
    expect(
      shouldAutoPopupMessageEditor({
        editMode: true,
        index: 0,
        disableAutoPopupMessageEditor: true,
      }),
    ).toBe(false)
  })

  it('stays disabled outside edit mode and placeholder rows', () => {
    expect(
      shouldAutoPopupMessageEditor({
        editMode: false,
        index: 0,
      }),
    ).toBe(false)
    expect(
      shouldAutoPopupMessageEditor({
        editMode: true,
        index: -1,
      }),
    ).toBe(false)
  })
})

describe('shouldAutoPopupTranslationEditor', () => {
  it('auto-opens the popup editor for translation edits by default', () => {
    expect(
      shouldAutoPopupTranslationEditor({
        editTranslationMode: true,
        index: 0,
      }),
    ).toBe(true)
  })

  it('uses the same accessibility opt-out as message edits', () => {
    expect(
      shouldAutoPopupTranslationEditor({
        editTranslationMode: true,
        index: 0,
        disableAutoPopupMessageEditor: true,
      }),
    ).toBe(false)
  })

  it('does not reopen after an auto-save rollback leaves inline translation edit open', () => {
    expect(
      shouldAutoPopupTranslationEditor({
        editTranslationMode: true,
        index: 0,
        suppressAutoPopupTranslationEditor: true,
      }),
    ).toBe(false)
  })

  it('stays disabled outside translation edit mode and placeholder rows', () => {
    expect(
      shouldAutoPopupTranslationEditor({
        editTranslationMode: false,
        index: 0,
      }),
    ).toBe(false)
    expect(
      shouldAutoPopupTranslationEditor({
        editTranslationMode: true,
        index: -1,
      }),
    ).toBe(false)
  })
})

describe('shouldUseStableMessageEditor', () => {
  it('uses stable inline height for multiline messages', () => {
    expect(
      shouldUseStableMessageEditor({
        editMode: true,
        index: 0,
        message: 'line one\nline two',
        theme: '',
      }),
    ).toBe(true)
  })

  it('uses stable inline height for long single-line messages', () => {
    expect(
      shouldUseStableMessageEditor({
        editMode: true,
        index: 0,
        message: 'a'.repeat(MESSAGE_EDIT_POPUP_LENGTH_THRESHOLD + 1),
        theme: '',
      }),
    ).toBe(true)
  })

  it('keeps short single-line messages on the compact inline editor', () => {
    expect(
      shouldUseStableMessageEditor({
        editMode: true,
        index: 0,
        message: 'short edit',
        theme: '',
      }),
    ).toBe(false)
  })

  it('stays disabled outside edit mode, placeholder rows, and special themes', () => {
    expect(
      shouldUseStableMessageEditor({
        editMode: false,
        index: 0,
        message: 'line one\nline two',
        theme: '',
      }),
    ).toBe(false)
    expect(
      shouldUseStableMessageEditor({
        editMode: true,
        index: -1,
        message: 'line one\nline two',
        theme: '',
      }),
    ).toBe(false)
    expect(
      shouldUseStableMessageEditor({
        editMode: true,
        index: 0,
        message: 'line one\nline two',
        theme: 'customHTML',
      }),
    ).toBe(false)
  })
})
