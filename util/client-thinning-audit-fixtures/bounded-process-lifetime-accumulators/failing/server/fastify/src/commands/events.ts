export class InMemoryCommandEventSink {
  private readonly events: string[] = []

  emit(event: string): void {
    this.events.push(event)
    if (this.events.length > 2) {
      this.events.splice(0, this.events.length - 2)
    }
  }
}
