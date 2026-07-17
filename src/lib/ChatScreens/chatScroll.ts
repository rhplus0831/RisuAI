export function scrollElementToContainerStart(element: Element, container: HTMLElement | null): void {
  if (!container?.contains(element)) return

  const elementTop = element.getBoundingClientRect().top
  const scrollportTop = container.getBoundingClientRect().top + container.clientTop
  const offset = elementTop - scrollportTop
  if (!Number.isFinite(offset)) return

  // Adjust only the transcript scroller. Element.scrollIntoView() also scrolls
  // ancestor scrollports and can leave the document itself offset.
  container.scrollTop += offset
}
