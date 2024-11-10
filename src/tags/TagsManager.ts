import { App, CachedMetadata, TFile } from "obsidian";


function getFileTags(file: TFile, ...tagPrefixes: string[]): string[] {
	const fileCache = app.metadataCache.getFileCache(file);
	if (!fileCache) return [];

	const tagsInFile: string[] = [];
	if (fileCache.frontmatter) {
		tagsInFile.push(...getFrontmatterTags(fileCache, ...tagPrefixes));
	}

	if (fileCache.tags && Array.isArray(fileCache.tags)) {
		tagsInFile.push(...fileCache.tags.map((v) => v.tag.replace(/^\#/, "")));
	}

	return tagsInFile;
}


function getFrontmatterTags(fileCache: CachedMetadata, ...prefixes: string[]): string[] {
    const frontmatter = fileCache.frontmatter;
    if (!frontmatter) return [];

    const frontMatterValues = Object.entries(frontmatter);
    if (!frontMatterValues.length) return [];

    const tagPairs = frontMatterValues.filter(([key, value]) => {
        const lowercaseKey = key.toLowerCase();
        return lowercaseKey === "tags" || lowercaseKey === "tag";
    });

    if (!tagPairs) return [];

    const tags = tagPairs
        .flatMap(([key, value]) => {
            if (typeof value === "string") {
                return value.split(/,|\s+/).map((v) => v.trim());
            } else if (Array.isArray(value)) {
                return value as string[];
            }
        })
        .filter((v) => !!v)
        .flatMap((tag) => {
            const matchingPrefixes = prefixes.filter((prefix) => tag.startsWith(prefix + '/'));
            if (matchingPrefixes.length > 0) {
                return matchingPrefixes.map((prefix) => tag);
            } else {
                return [];
            }
        }) as string[];

    return tags;
}

function getFileReferences(app: App, file: TFile, ...keys: string[]): TFile[] {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!frontmatter) return [];

  const frontMatterValues = Object.entries(frontmatter);
  if (!frontMatterValues.length) return [];

  const referenceEntries = frontMatterValues.filter(([key, value]) => {
    const lowercaseKey = key.toLowerCase();
    return keys.some(k => lowercaseKey === k.toLowerCase());
  });

  const fileReferences: TFile[] = referenceEntries.flatMap(([key, value]) => {
    if (typeof value === 'string') {
      const [path, display] = value.split('|').map(v => v.trim());
      const referenceFile = app.vault.getAbstractFileByPath(path);
      if (referenceFile instanceof TFile) {
        return [referenceFile];
      }
    } else if (Array.isArray(value)) {
      return value.map(v => {
        const [path, display] = (v as string).split('|').map(v => v.trim());
        const referenceFile = app.vault.getAbstractFileByPath(path);
        if (referenceFile instanceof TFile) {
          return referenceFile;
        }
      }).filter((file): file is TFile => file !== undefined);
    }
    return [];
  });

  return fileReferences;
}


export class TagsManager {

	constructor(private app: App) {}

	async updateInherited(file: TFile) {
		// console.log("updateInherited");
		// const tags = getFileTags(file, 'inherited');
		// console.log(tags);
	}
	
	async updateRelated(file: TFile) {
		console.log("updateRelated");
		const tags = getFileTags(file, 'related');
		console.log(tags);
		
	}

}


