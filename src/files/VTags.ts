import { FrontMatterCache } from "obsidian";
import { AMetaProperty } from "./AMetaProperty";


// normal tag: kubernetes
// from parent: p/infra/tool
// from related (related-to): r/dev/tool/git

export class VTags extends AMetaProperty {
  
  constructor(protected frontmatter: FrontMatterCache) { 
    super(frontmatter);
  }

  private findTags() {
    const tagPairs = this.frontmatter.filter(([key, value]) => {
        const lowercaseKey = key.toLowerCase();
        return lowercaseKey === "tags" || lowercaseKey === "tag";
    });

    if (!tagPairs) return [];
  }

  public get all() {
    
  }

}

