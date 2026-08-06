/**
 * Shared element-tree traversal helpers. Pre-order flatten, id-indexing, and
 * subtree-id collection used across parse, layout, and validation stages.
 * Kept iterative to stay stack-safe for deeply nested trees.
 */

import type { Element } from "./models/ast.ts";

export function subtreeIds(element: Element): string[] {
  const ids: string[] = [];
  const stack: Element[] = [element];
  while (stack.length) {
    const node = stack.pop()!;
    ids.push(node.id);
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
  }
  return ids;
}

export function subtreeElements(element: Element): Element[] {
  const elements: Element[] = [];
  const stack: Element[] = [element];
  while (stack.length) {
    const node = stack.pop()!;
    elements.push(node);
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
  }
  return elements;
}

export function indexElementsById(elements: Element[]): [string, Element][] {
  const result: [string, Element][] = [];
  for (const element of elements) {
    for (const desc of subtreeElements(element)) {
      result.push([desc.id, desc]);
    }
  }
  return result;
}
