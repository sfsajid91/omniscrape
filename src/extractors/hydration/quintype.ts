import type { PageContext } from "../../core/context";
import type { ExtractedData, ValueEvidence } from "../../core/evidence";
import { emailAddress, isRecord, personName } from "../../values";

export function publisherNamespace(context: PageContext): string {
  try {
    return new URL(context.pageUrl).host.toLowerCase();
  } catch {
    return "unknown-publisher";
  }
}

export function quintypeRoot(value: unknown, path: string): { value: unknown; path: string } {
  if (isRecord(value) && isRecord(value.qt) && value.qt.data !== undefined) return { value: value.qt.data, path: `${path}.qt.data` };
  if (isRecord(value) && value.data !== undefined) return { value: value.data, path: `${path}.data` };
  return { value, path };
}

function addField(out: ExtractedData, field: string, value: string | number, source: string, sourcePath: string, scope: ValueEvidence["scope"]): void {
  out.fields.push({ field, value, evidence: { source: `hydration:${source}`, sourcePath, scope, confidence: "medium" } });
}

export function correlateQuintypeCollectionEntities(
  root: unknown,
  rootPath: string,
  sourceName: string,
  context: PageContext,
  out: ExtractedData,
): void {
  if (!isRecord(root)) return;
  const authorObj = isRecord(root.author) ? root.author : undefined;
  const authorId = authorObj ? authorObj.id : undefined;
  const authorName = authorObj ? personName(authorObj.name ?? authorObj["author-name"]) : undefined;

  const collection = isRecord(root.authorCollection)
    ? root.authorCollection
    : isRecord(root.collection)
    ? root.collection
    : undefined;
  if (!collection || !Array.isArray(collection.items)) return;

  const seenAuthorEmails = new Set<string>();
  const seenOwnerEmails = new Set<string>();

  for (const [itemIndex, item] of collection.items.entries()) {
    if (!isRecord(item)) continue;
    const story = isRecord(item.story) ? item.story : undefined;
    if (!story) continue;
    const ownerId = story["owner-id"] ?? story.ownerId;
    const itemPath = `${rootPath}.authorCollection.items[${itemIndex}].story`;

    const candidatesToCheck: Array<{ author: Record<string, unknown>; path: string }> = [];

    if (Array.isArray(story.authors)) {
      for (const [aIdx, a] of story.authors.entries()) {
        if (isRecord(a)) candidatesToCheck.push({ author: a, path: `${itemPath}.authors[${aIdx}]` });
      }
    }

    if (Array.isArray(story.cards)) {
      for (const [cIdx, card] of story.cards.entries()) {
        if (!isRecord(card) || !Array.isArray(card["story-elements"])) continue;
        for (const [eIdx, el] of card["story-elements"].entries()) {
          if (!isRecord(el) || !isRecord(el.metadata)) continue;
          const linkedStory = el.metadata["linked-story"];
          if (isRecord(linkedStory) && Array.isArray(linkedStory.authors)) {
            for (const [laIdx, la] of linkedStory.authors.entries()) {
              if (isRecord(la)) {
                candidatesToCheck.push({
                  author: la,
                  path: `${itemPath}.cards[${cIdx}].story-elements[${eIdx}].metadata.linked-story.authors[${laIdx}]`,
                });
              }
            }
          }
        }
      }
    }

    for (const { author: cand, path: candPath } of candidatesToCheck) {
      const email = emailAddress(cand.email);
      if (!email) continue;
      const cId = cand.id;

      if (authorId !== undefined && cId !== undefined && String(cId) === String(authorId)) {
        if (!seenAuthorEmails.has(email)) {
          seenAuthorEmails.add(email);
          const name = personName(cand.name) ?? authorName;
          if (name) {
            out.authors.push({
              identity: `${sourceName}@${publisherNamespace(context)}:${cId}`,
              primary: true,
              profile: {
                name,
                id: typeof cId === "number" ? cId : String(cId),
                email,
                emails: [email],
                socials: [],
              },
              evidence: {
                name: { source: `hydration:${sourceName}`, sourcePath: `${candPath}.name`, scope: "profile", confidence: "high" },
                email: { source: `hydration:${sourceName}`, sourcePath: `${candPath}.email`, scope: "profile", confidence: "high" },
                id: { source: `hydration:${sourceName}`, sourcePath: `${candPath}.id`, scope: "profile", confidence: "high" },
              },
            });
          }
        }
      }

      if (ownerId !== undefined && cId !== undefined && String(cId) === String(ownerId)) {
        if (!seenOwnerEmails.has(email)) {
          seenOwnerEmails.add(email);
          addField(out, "editorial.ownerEmail", email, sourceName, `${candPath}.email`, "publisher");
        }
      }
    }
  }
}
