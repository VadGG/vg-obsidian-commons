import { FrontMatterCache } from "obsidian";
import { AMetaProperty } from "./AMetaProperty";


export class VLinks extends AMetaProperty {
  
  constructor(private fieldName: string, protected frontmatter: FrontMatterCache) { 
    super(frontmatter);
  }

}
