import { App, TFile } from "obsidian";

import { VMeta } from "./VMeta";

export class VFile {

  private _meta: VMeta;
  
  constructor(private app: App, private file: TFile) {
    
  }

  private get meta() {
    if (this._meta) {
      return this._meta;
    }
    const cache = this.app.metadataCache.getFileCache(this.file);
    if (!cache) {
      return this._meta;
    }

    this._meta = new VMeta(this.app, cache);
  }


  
}
