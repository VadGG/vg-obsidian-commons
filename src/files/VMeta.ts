import { App, CachedMetadata, FrontMatterCache, TFile } from "obsidian";

import { VLinks } from "./VLinks";
import { VTags } from "./VTags";

export class VMeta {

  private frontmatter: FrontMatterCache;
  private _tags: VTags;
  private _links: VLinks;

  constructor(private app: App, private cache: CachedMetadata) {
    const frontmatter = cache.frontmatter;
    if (frontmatter) {
      this.frontmatter = frontmatter;
    }
  }

  public get tags() {
    if (!this._tags) {
      this._tags = new VTags(this.cache);
    }

    return this._tags;
  }
  
}
