import { App, TFolder, Editor, MarkdownView, Modal, Notice, ToggleComponent, Plugin, PluginSettingTab, Setting, TFile, TAbstractFile, FuzzySuggestModal, TextComponent } from 'obsidian';
import matter from 'gray-matter';

interface ResourceTypeSettings {
    name: string;
    folderName: string;
    templatePath: string;
    allowedParentClasses: string[];
    requiresParent?: boolean;
    addNameAsTag?: boolean;
    moveOnParentChange?: boolean; // New option
}

interface MyPluginSettings {
	selectorIgnoreFolderName: string;
    resourceTypes: Record<string, ResourceTypeSettings>;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	selectorIgnoreFolderName: '99_Organize',

    resourceTypes: {
        'Topic': {
            name: 'Topic',
            folderName: '10_Topics',
            templatePath: '99_Organize/Templates/TopicTemplate.md',
            allowedParentClasses: [],
            requiresParent: false,
            addNameAsTag: false,
            moveOnParentChange: false

        },
        'SubTopic': {
            name: 'SubTopic',
            folderName: '00_Subtopics',
            templatePath: '99_Organize/Templates/SubtopicTemplate.md',
            allowedParentClasses: ['Topic'],
            requiresParent: true,
            addNameAsTag: true,
            moveOnParentChange: true
        },
        'HowTo': {
            name: 'How To',
            folderName: '20_HowTos',
            templatePath: '99_Organize/Templates/HowToTemplate.md',
            allowedParentClasses: ['Topic', 'SubTopic'],
            addNameAsTag: false,
            moveOnParentChange: true
        },
        'Resource': {
            name: 'Resource',
            folderName: '30_Resources',
            templatePath: '99_Organize/Templates/20_Resources/ResourceTemplate.md',
            allowedParentClasses: ['Topic', 'SubTopic'],
            addNameAsTag: false,
            moveOnParentChange: true
        },
        'BlogResource': {
            name: 'Resource - Blog',
            folderName: '35_Resources_Blog',
            templatePath: '99_Organize/Templates/20_Resources/BlogTemplate.md',
            allowedParentClasses: ['Topic', 'SubTopic'],
            addNameAsTag: false,
            moveOnParentChange: true
        },
        'DocumentationResource': {
            name: 'Resource - Documentation',
            folderName: '40_Resources_Documentation',
            templatePath: '99_Organize/Templates/20_Resources/DocumentationTemplate.md',
            allowedParentClasses: ['Topic', 'SubTopic'],
            addNameAsTag: false,
            moveOnParentChange: true
        },
        'GithubResource': {
            name: 'Resource - Github',
            folderName: '45_Resources_Github',
            templatePath: '99_Organize/Templates/20_Resources/GithubTemplate.md',
            allowedParentClasses: ['Topic', 'SubTopic'],
            addNameAsTag: false,
            moveOnParentChange: true
        },
        'GithubIssueResource': {
            name: 'Resource - Github Issue',
            folderName: '50_GithubIssueResources',
            templatePath: '99_Organize/Templates/20_Resources/GithubIssueTemplate.md',
            allowedParentClasses: ['Topic', 'SubTopic'],
            addNameAsTag: false,
            moveOnParentChange: true
        },
        'StackOverflowResource': {
            name: 'Resource - Stack Overflow',
            folderName: '55_Resources_StackOverflow',
            templatePath: '99_Organize/Templates/20_Resources/StackOverflowTemplate.md',
            allowedParentClasses: ['Topic', 'SubTopic'],
            addNameAsTag: false,
            moveOnParentChange: true
        },
        'RedditResource': {
            name: 'Resource - Reddit',
            folderName: '60_RedditResources',
            templatePath: '99_Organize/Templates/20_Resources/RedditTemplate.md',
            allowedParentClasses: ['Topic', 'SubTopic'],
            addNameAsTag: false,
            moveOnParentChange: true
        },

        'YoutubeResource': {
            name: 'Resource - Youtube',
            folderName: '65_YoutubeResources',
            templatePath: '99_Organize/Templates/20_Resources/YoutubeTemplate.md',
            allowedParentClasses: ['Topic', 'SubTopic'],
            addNameAsTag: false,
            moveOnParentChange: true
        }
    }
};


class InputModal extends Modal {
    private inputEl: TextComponent;
    private resolvePromise: (value: string | null) => void;

    constructor(app: App, private placeholder: string) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        this.inputEl = new TextComponent(contentEl).setPlaceholder(this.placeholder);

        this.inputEl.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.resolvePromise(this.inputEl.getValue());
                this.close();
            }
            if (e.key === 'Escape') {
                this.resolvePromise(null);
                this.close();
            }
        });

        this.inputEl.inputEl.focus();
    }

    async getUserInput(): Promise<string | null> {
        return new Promise((resolve) => {
            this.resolvePromise = resolve;
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}

interface ResourceType {
    name: string;
    folderName: string;
    templatePath: string;
    allowedParentClasses: string[];
}

class BaseResourceCreator {
    private settings: MyPluginSettings;
    private app: App;

    constructor(
        protected plugin: MyPlugin,
        protected templateService: TemplateService,
        protected fileService: FileService,
        protected tagService: TagService
    ) {
        this.settings = plugin.settings;
        this.app = plugin.app;
    }


    protected async getUserInput(placeholder: string): Promise<string | null> {
        const inputModal = new InputModal(this.plugin.app, placeholder);
        inputModal.open();
        return inputModal.getUserInput();
    }

    protected async getSelectedParent(topicSelector: TopicSelectorModal, folderName: string) {
        return new Promise<{file: TFile, parentPath: string}>((resolve) => {
            topicSelector.onChooseItem = async (file) => {
                const cache = this.plugin.app.metadataCache.getFileCache(file);
                const frontmatter = cache?.frontmatter;
                
                if (frontmatter?.Class === 'Topic' && frontmatter.subfolder) {
                    resolve({
                        file,
                        parentPath: `${frontmatter.subfolder}/${folderName}`
                    });
                } else if (frontmatter?.Class === 'SubTopic' && frontmatter.parent) {
                    const parentMatch = frontmatter.parent.match(/\[\[(.*?)(?:\|.*?)?\]\]/);
                    if (parentMatch) {
                        const parentFile = this.plugin.app.metadataCache.getFirstLinkpathDest(parentMatch[1], file.path);
                        const parentFrontmatter = this.plugin.app.metadataCache.getFileCache(parentFile)?.frontmatter;
                        if (parentFrontmatter?.subfolder) {
                            resolve({
                                file,
                                parentPath: `${parentFrontmatter.subfolder}/${folderName}/${file.basename}`
                            });
                        }
                    }
                }
            };
        });
    }

    protected async createResourceFile(template: TFile, selected: {file: TFile, parentPath: string}, resourceName: string, resourceType: string) {
        const templateContent = await this.plugin.app.vault.read(template);
        const inheritedTags = await this.tagService.getInheritedTags(selected.file);
        const config = this.plugin.settings.resourceTypes[resourceType];

        const updatedContent = await this.templateService.updateFrontmatter(templateContent, {
            parent: `[[${selected.file.path}|${selected.file.basename}]]`,
            tags: inheritedTags,
        },config?.addNameAsTag ? resourceName : undefined);
    
        const resourcePath = `${selected.parentPath}/${resourceName}.md`;
        const newFile = await this.fileService.createFile(resourcePath, updatedContent);
        await this.fileService.revealInExplorer(newFile);
        await this.fileService.openFile(newFile);
    
        new Notice(`Created new ${resourceType}: ${resourceName}`);
    }

    protected async createNoteResource(
        templatePath: string,
        targetPath: string,
        name: string,
        parentFile?: TFile,
        resourceType: string = 'resource'
    ): Promise<void> {
        const template = await this.templateService.loadTemplate(templatePath);
        if (!template) {
            new Notice(`${resourceType} template not found in ${templatePath}!`);
            return;
        }

        const templateContent = await this.app.vault.read(template);
        let updatedContent = templateContent;
        const config = this.plugin.settings.resourceTypes[resourceType];

        if (parentFile) {
            const inheritedTags = await this.tagService.getInheritedTags(parentFile);
            updatedContent = await this.templateService.updateFrontmatter(templateContent, {
                parent: `[[${parentFile.path}|${parentFile.basename}]]`,
                tags: inheritedTags,
            }, config?.addNameAsTag ? name : undefined);
        }

        const filePath = `${targetPath}/${name}.md`;
        const newFile = await this.fileService.createFile(filePath, updatedContent);
        await this.fileService.revealInExplorer(newFile);
        await this.fileService.openFile(newFile);

        new Notice(`Created new ${resourceType}: ${name}`);
    }


}

class ResourceManager extends BaseResourceCreator {
    constructor(
        plugin: MyPlugin,
        templateService: TemplateService,
        fileService: FileService,
        tagService: TagService
    ) {
        super(plugin, templateService, fileService, tagService);
    }


    getResourceTypes(): string[] {
        return Object.keys(this.plugin.settings.resourceTypes);
    }

    getResources(): ResourceTypeSettings[] {
        return Object.values(this.plugin.settings.resourceTypes);
    }

    getResourceConfig(resourceType: string): ResourceTypeSettings | undefined {
        return this.plugin.settings.resourceTypes[resourceType];
    }

    async addResourceType(
        key: string, 
        config: ResourceTypeSettings
    ): Promise<void> {
        this.plugin.settings.resourceTypes[key] = config;
        await this.plugin.saveSettings();
    }

    async removeResourceType(key: string): Promise<void> {
        delete this.plugin.settings.resourceTypes[key];
        await this.plugin.saveSettings();
    }

    protected async createResourceWithConfig(config: ResourceType, name: string): Promise<void> {
        if (config.allowedParentClasses.length > 0) {
            const topicSelector = new TopicSelectorModal(this.plugin.app, this.plugin.settings, config.allowedParentClasses);
            topicSelector.open();
            const selected = await this.getSelectedParent(topicSelector, config.folderName);
            if (!selected) return;
            const resourceName = await this.getUserInput(`Enter ${config.name} name`);
            if (!resourceName) return;
    
            const template = await this.templateService.loadTemplate(config.templatePath);
            if (!template) {
                new Notice(`${config.name} template not found!`);
                return;
            }
            await this.createNoteResource(
                config.templatePath,
                selected.parentPath,
                resourceName,
                selected.file,
                config.name
            );
        } else {
            const resourceName = await this.getUserInput(`Enter ${config.name} name`);
            if (!resourceName) return;
    
            const template = await this.templateService.loadTemplate(config.templatePath);
            if (!template) {
                new Notice(`${config.name} template not found!`);
                return;
            }
            await this.createNoteResource(
                config.templatePath,
                config.folderName,
                resourceName,
                undefined,
                config.name
            );
        }
    }

    protected async createResource(resourceType: string): Promise<void> {
        const config = this.plugin.settings.resourceTypes[resourceType];
        if (!config) return;

        this.createResourceWithConfig(config, resourceType);
    }
    

    

}

class TemplateService {
    constructor(private app: App, private settings: MyPluginSettings) {}

    async loadTemplate(templatePath: string): Promise<TFile | null> {
        const template = await this.app.vault.getAbstractFileByPath(templatePath);
        return template instanceof TFile ? template : null;
    }

    async updateFrontmatter(content: string, updates: Record<string, any>,noteName?: string): Promise<string> {
        const { data: frontmatter, content: templateContent } = matter(content);
        // Preserve existing tags if any
        const existingTags = frontmatter.tags || [];
        const existingTagsArray = Array.isArray(existingTags) ? existingTags : [existingTags];
        
        // Merge with inherited tags
        const inheritedTags = updates.tags || [];
        
        // Format note name as tag if provided
        const formattedTag = noteName ? noteName.toLowerCase().replace(/\s+/g, '_') : null;

        // Add note name as tag if provided
        const allTags = formattedTag 
        ? [...new Set([...existingTagsArray, ...inheritedTags, formattedTag])]
        : [...new Set([...existingTagsArray, ...inheritedTags])];

        // Update frontmatter with merged tags
        const updatedFrontmatter = {
            ...frontmatter,
            ...updates,
            tags: allTags
        };
        
        return matter.stringify(templateContent, updatedFrontmatter);
    }
}

class FileService {
    constructor(private app: App) {}

    async createFile(path: string, content: string): Promise<TFile> {
        await this.ensureDirectory(path);
        return await this.app.vault.create(path, content);
    }

	async openFile(file: TFile): Promise<void> {
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(file);
    }

    async ensureDirectory(path: string): Promise<void> {
        const dirs = path.split('/').slice(0, -1).join('/');
        if (dirs && !(await this.app.vault.adapter.exists(dirs))) {
            await this.app.vault.createFolder(dirs);
        }
    }

    async revealInExplorer(file: TFile): Promise<void> {
        const explorerLeaf = this.app.workspace.getLeavesOfType('file-explorer')[0];
        if (explorerLeaf) {
            const explorerView = explorerLeaf.view as any;
            await explorerView.revealInFolder(file, true);
        }
    }
}

class TagService {
    constructor(private app: App) {}

    prefixTag(prefix: string, tag: string): string {
        if (!prefix) return tag;
        if (tag.contains(prefix)) return tag;
        return `${prefix}/${tag}`;
    }

    async getInheritedTags(file: TFile): Promise<string[]> {
        const tags = new Set<string>();
        const cache = this.app.metadataCache.getFileCache(file);
        const prefix = "";

        // Add current file tags
        if (cache?.frontmatter?.tags) {
            const currentTags = Array.isArray(cache.frontmatter.tags) 
                ? cache.frontmatter.tags 
                : [cache.frontmatter.tags];
            currentTags.forEach(tag => tags.add(this.prefixTag(prefix, tag)));
        }

        // Get parent's tags
        if (cache?.frontmatter?.parent) {
            const parentMatch = cache.frontmatter.parent.match(/\[\[(.*?)(?:\|.*?)?\]\]/);
            if (parentMatch) {
                const parentFile = this.app.metadataCache.getFirstLinkpathDest(parentMatch[1], file.path);
                if (parentFile instanceof TFile) {
                    const parentTags = await this.getInheritedTags(parentFile);
                    parentTags.forEach(tag => tags.add(this.prefixTag(prefix, tag)));
                }
            }
        }

        return Array.from(tags);
    }
}


class TopicSelectorModal extends FuzzySuggestModal<TFile> {
    constructor(app: App, private settings: MyPluginSettings, private allowedClasses: string[]) {
        super(app);
        this.setPlaceholder(`Select a ${allowedClasses.join(' or ')} note`);
    }

    getItems(): TFile[] {
        return this.app.vault.getMarkdownFiles().filter((file) => {
            // Use the setting from plugin.settings
            if (file.path.startsWith(`${this.settings.selectorIgnoreFolderName}/`)) return false;
    
            const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
            if (!frontmatter?.Class) return false;
    
            const classMatch = this.allowedClasses
                .map((c) => c.toLowerCase())
                .includes(frontmatter.Class.toLowerCase());
                
            return frontmatter.Class === 'Topic'
                ? classMatch && !!frontmatter.subfolder
                : classMatch;
        });
    }

    getItemText(file: TFile): string {
        const cache = this.app.metadataCache.getFileCache(file);
        const frontmatter = cache?.frontmatter;
        if (frontmatter?.Class === 'SubTopic' && frontmatter.parent) {
            const parentMatch = frontmatter.parent.match(/\[\[.*\|(.*?)\]\]/) || frontmatter.parent.match(/\[\[(.*?)\]\]/);
            const parentName = parentMatch ? parentMatch[1] : 'Unknown Parent';
            return `${parentName} - ${file.basename}`;
        }
        return file.basename;
    }

    onChooseItem(file: TFile): void {
        console.log('Selected file:', file);
    }
}

class ActionSelectorModal extends FuzzySuggestModal<string> {
    private resourceManager: ResourceManager;
    constructor(
        private plugin: MyPlugin,
        private templateService: TemplateService,
        private fileService: FileService,
        private tagService: TagService,
    ) {
        super(plugin.app);
        this.setPlaceholder('Select action');
        this.resourceManager = new ResourceManager(plugin, templateService, fileService, tagService);
    }

    getItems(): string[] {
        const baseActions = [];
        const resourceActions = Object.entries(this.plugin.settings.resourceTypes)
            .map(([_, config]) => `New ${config.name}`);
        return [...baseActions, ...resourceActions];
    }

    getItemText(action: string): string {
        return action; // Display the action text in the modal
    }

    async onChooseItem(action: string): Promise<void> {
        const actionMap: Record<string, () => Promise<void>> = {};
    
        // Find the resource type key by matching the displayed name
        const resourceTypeKey = Object.entries(this.plugin.settings.resourceTypes)
            .find(([_, config]) => `New ${config.name}` === action)?.[0];
    
        const handler = actionMap[action] || 
            (() => this.resourceManager.createResource(resourceTypeKey || ''));
            
        await handler();
    }

}

class NoteService {
    constructor(
        private app: App,
        private settings: MyPluginSettings,
        private fileService: FileService,
        private tagService: TagService
    ) {}

    async findTopicWithSubfolder(file: TFile): Promise<string | null> {
        const cache = this.app.metadataCache.getFileCache(file);
        const frontmatter = cache?.frontmatter;
    
        if (frontmatter?.Class === 'Topic' && frontmatter.subfolder) {
            return frontmatter.subfolder;
        }
    
        if (frontmatter?.parent) {
            const parentMatch = frontmatter.parent.match(/\[\[(.*?)(?:\|.*?)?\]\]/);
            if (parentMatch) {
                const parentFile = this.app.metadataCache.getFirstLinkpathDest(parentMatch[1], file.path);
                if (parentFile instanceof TFile) {
                    return this.findTopicWithSubfolder(parentFile);
                }
            }
        }
    
        return null;
    }

    async changeNoteParent(activeFile: TFile, newParent: TFile): Promise<void> {
        const content = await this.app.vault.read(activeFile);
        const { data: frontmatter, content: fileContent } = matter(content);
        
        // Get current tags
        const currentTags = frontmatter.tags || [];
        const currentTagsArray = Array.isArray(currentTags) ? currentTags : [currentTags];
        
        // Get old inherited tags to remove them
        const oldParentMatch = frontmatter.parent?.match(/\[\[(.*?)(?:\|.*?)?\]\]/);
        const oldInheritedTags = oldParentMatch 
            ? await this.tagService.getInheritedTags(
                this.app.metadataCache.getFirstLinkpathDest(oldParentMatch[1], activeFile.path)
              )
            : [];
        
        // Remove old inherited tags, keeping custom ones
        const customTags = currentTagsArray.filter(tag => !oldInheritedTags.includes(tag));
        
        // Get and add new inherited tags
        const newInheritedTags = await this.tagService.getInheritedTags(newParent);
        frontmatter.tags = [...new Set([...customTags, ...newInheritedTags])];
        frontmatter.parent = `[[${newParent.path}|${newParent.basename}]]`;
        
        const updatedContent = matter.stringify(fileContent, frontmatter);
    
        const resourceType = this.settings.resourceTypes[frontmatter.Class];
        if (resourceType?.moveOnParentChange) {
            const topicSubfolder = await this.findTopicWithSubfolder(newParent);
            if (topicSubfolder) {
                const newParentCache = this.app.metadataCache.getFileCache(newParent);
                const newParentFrontmatter = newParentCache?.frontmatter;
                
                // Build the path including the subtopic folder
                const subtopicPath = newParentFrontmatter?.Class === 'SubTopic' 
                    ? `/${newParent.basename}` 
                    : '';
                const newPath = `${topicSubfolder}/${resourceType.folderName}${subtopicPath}/${activeFile.basename}.md`;
                
                if (newPath !== activeFile.path) {
                    const newDir = `${topicSubfolder}/${resourceType.folderName}${subtopicPath}`;
                    if (!(await this.app.vault.adapter.exists(newDir))) {
                        await this.app.vault.createFolder(newDir);
                    }
                    
                    await this.app.fileManager.renameFile(activeFile, newPath);
                    const movedFile = this.app.vault.getAbstractFileByPath(newPath);
                    if (movedFile instanceof TFile) {
                        await this.app.vault.modify(movedFile, updatedContent);
                        await this.fileService.revealInExplorer(movedFile);
                    }
                    return;
                }
            }
        }

        await this.app.vault.modify(activeFile, updatedContent);

        // if (frontmatter.Class === 'SubTopic') {
        //     const parentFrontmatter = this.app.metadataCache.getFileCache(newParent)?.frontmatter;
        //     if (parentFrontmatter?.subfolder) {
        //         const newPath = `${parentFrontmatter.subfolder}/${this.settings.subtopicFolderName}/${activeFile.basename}.md`;
        //         await this.app.fileManager.renameFile(activeFile, newPath);
        //         const movedFile = this.app.vault.getAbstractFileByPath(newPath);
        //         if (movedFile instanceof TFile) {
        //             await this.app.vault.modify(movedFile, updatedContent);
        //         }
        //     }
        // } else {
        //     await this.app.vault.modify(activeFile, updatedContent);
        // }
    }
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	templateService: TemplateService;
	fileService: FileService;

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

	onunload() {

	}
	
	async onload() {
		await this.loadSettings();
		const templateService = new TemplateService(this.app, this.settings);
		const fileService = new FileService(this.app);
        const tagService = new TagService(this.app);
        const noteService = new NoteService(this.app, this.settings, fileService, tagService);


		this.addSettingTab(new SettingTab(this.app, this));
        // this.addCommand(id: "", name: "Open Action Selector", callback: () => new ActionSelectorModal(this, templateService, fileService).open());

		this.addCommand({
			id: 'create-new-content',
			name: 'Create New Content',
			callback: () => {
				new ActionSelectorModal(this, templateService, fileService, tagService).open();
			}
		});

        this.addCommand({
            id: 'change-note-parent',
            name: 'Change Note Parent',
            callback: async () => {
                const activeFile = this.app.workspace.getActiveFile();
                if (!activeFile) {
                    new Notice('No active file');
                    return;
                }
        
                const frontmatter = this.app.metadataCache.getFileCache(activeFile)?.frontmatter;
                const currentClass = frontmatter?.Class;
                
                const resourceManager = new ResourceManager(
                    this, 
                    templateService, 
                    fileService, 
                    tagService
                );
                
                const resourceType = this.settings.resourceTypes[currentClass];
                
                if (!resourceType?.allowedParentClasses?.length) {
                    new Notice('This note type cannot have a parent');
                    return;
                }
        
                const topicSelector = new TopicSelectorModal(
                    this.app, 
                    this.settings, 
                    resourceType.allowedParentClasses
                );
                topicSelector.open();
        
                const newParent = await new Promise<TFile | null>((resolve) => {
                    topicSelector.onChooseItem = (file) => resolve(file);
                });
        
                if (!newParent) return;
        
                await noteService.changeNoteParent(activeFile, newParent);
                new Notice('Parent changed successfully');
            }
        });

	}
}


class SettingTab extends PluginSettingTab {
    constructor(app: App, private plugin: MyPlugin) {
        super(app, plugin);
    }

    createFolderSelector(
        containerEl: HTMLElement,
        name: string,
        desc: string,
        currentValue: string,
        settingKey: keyof MyPluginSettings,
        allowFiles: boolean = false
    ) {
        const setting = new Setting(containerEl)
            .setName(name)
            .setDesc(desc)
            .addSearch(search => {
                let isModalOpen = false;
                
                // Style the search container and input
                const searchContainer = search.inputEl.parentElement;
                if (searchContainer) {
                    searchContainer.style.width = '100%';
                }
                search.inputEl.style.width = '100%';
                
                search
                    .setPlaceholder(`Example: ${currentValue}`)
                    .setValue(this.plugin.settings[settingKey])
                    .onChange(async (value) => {
                        this.plugin.settings[settingKey] = value;
                        await this.plugin.saveSettings();
                    });
                
                let previousValue = this.plugin.settings[settingKey];
                
                search.inputEl.addEventListener('focus', () => {
                    if (isModalOpen) {
                        search.inputEl.blur();
                        return;
                    }
                    
                    isModalOpen = true;
                    const modal = new FolderSuggestModal(
                        this.app,
                        allowFiles,
                        (item) => {
                            if (item) {
                                const path = item instanceof TFolder ? item.path : item.path;
                                search.setValue(path);
                                this.plugin.settings[settingKey] = path;
                                this.plugin.saveSettings();
                            }
                            setTimeout(() => {
                                search.inputEl.blur();
                                isModalOpen = false;
                            }, 50);
                        },
                        () => {
                            search.setValue(previousValue);
                            this.plugin.settings[settingKey] = previousValue;
                            this.plugin.saveSettings();
                            setTimeout(() => {
                                search.inputEl.blur();
                                isModalOpen = false;
                            }, 50);
                        }
                    );
                    modal.open();
                });
            });

        // Style the setting container for better layout
        setting.settingEl.style.display = 'grid';
        setting.settingEl.style.gridTemplateColumns = '1fr';
        setting.settingEl.style.gap = '6px';
        
        // Make the control container take full width
        const controlEl = setting.settingEl.querySelector('.setting-item-control');
        if (controlEl instanceof HTMLElement) {
            controlEl.style.width = '100%';
            controlEl.style.display = 'flex';
            controlEl.style.justifyContent = 'flex-start';
            controlEl.style.minWidth = '300px'; // Ensure minimum width
        }

        // Make the info container take full width
        const infoEl = setting.settingEl.querySelector('.setting-item-info');
        if (infoEl instanceof HTMLElement) {
            infoEl.style.width = '100%';
        }

        return setting;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Settings for My Plugin' });
        // Selector Ignore Folder
        this.createFolderSelector(
            containerEl,
            'Selector Ignore Folder',
            'Folder to ignore when selecting topics.',
            '99_Organize',
            'selectorIgnoreFolderName',
            false
        );

        containerEl.createEl('h3', { text: 'Resource Types' });
        new Setting(containerEl)
        .setName('Manage Resource Types')
        .setDesc('Add, edit, or remove resource types')
        .addButton(button => button
            .setButtonText('Add Resource Type')
            .onClick(() => {
                // Open a modal to add a new resource type
                this.openResourceTypeModal();
            }));
        
        Object.entries(this.plugin.settings.resourceTypes).forEach(([key, config]) => {
            new Setting(containerEl)
                .setName(config.name)
                .addButton(editButton => 
                    editButton
                        .setButtonText('Edit')
                        .onClick(() => this.openResourceTypeModal(key, config))
                )
                .addButton(deleteButton => 
                    deleteButton
                        .setButtonText('Delete')
                        .onClick(async () => {
                            await this.plugin.resourceManager.removeResourceType(key);
                            this.display(); // Refresh settings
                        }));
        });

    }

    openResourceTypeModal(
        existingKey?: string, 
        existingConfig?: ResourceTypeSettings
    ) {
        new ResourceTypeModal(
            this.app, 
            this.plugin,
            new TemplateService(this.app, this.plugin.settings),
            new FileService(this.app),
            new TagService(this.app),
            existingKey, 
            existingConfig
        ).open();
    }
}

class ResourceTypeModal extends Modal {
    private nameInput: TextComponent;
    private folderNameInput: TextComponent;
    private templatePathInput: TextComponent;
    private allowedParentsInput: TextComponent;
    private requiresParentToggle: ToggleComponent;
    private resourceManager: ResourceManager;
    private existingKey?: string;
    private addNameAsTagToggle: ToggleComponent;

    constructor(
        app: App, 
        private plugin: MyPlugin,
        private templateService: TemplateService,
        private fileService: FileService,
        private tagService: TagService,
        existingKey?: string, 
        existingConfig?: ResourceTypeSettings
    ) {
        super(app);
        this.existingKey = existingKey;
        this.resourceManager = new ResourceManager(
            plugin, 
            templateService, 
            fileService, 
            tagService
        );
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { 
            text: this.existingKey 
                ? `Edit Resource Type: ${this.existingKey}` 
                : 'Add New Resource Type' 
        });

        // Name Input
        new Setting(contentEl)
            .setName('Resource Type Name')
            .setDesc('A descriptive name for this resource type')
            .addText(text => {
                this.nameInput = text;
                text.setValue(this.existingKey || '')
                    .setPlaceholder('e.g., Topic, SubTopic, HowTo');
            });

        // Folder Name Input
        new Setting(contentEl)
            .setName('Folder Name')
            .setDesc('Folder where these resources will be stored')
            .addText(text => {
                this.folderNameInput = text;
                text.setValue(this.existingKey 
                    ? this.plugin.settings.resourceTypes[this.existingKey]?.folderName 
                    : ''
                )
                .setPlaceholder('e.g., 10_Topics, 00_Subtopics');
            });

        // Template Path Input
        new Setting(contentEl)
            .setName('Template Path')
            .setDesc('Path to the template file for this resource type')
            .addText(text => {
                this.templatePathInput = text;
                text.setValue(this.existingKey 
                    ? this.plugin.settings.resourceTypes[this.existingKey]?.templatePath 
                    : ''
                )
                .setPlaceholder('e.g., 99_Organize/Templates/TopicTemplate.md');
            });

        // Allowed Parents Input
        new Setting(contentEl)
            .setName('Allowed Parent Classes')
            .setDesc('Comma-separated list of allowed parent resource types')
            .addText(text => {
                this.allowedParentsInput = text;
                text.setValue(this.existingKey 
                    ? this.plugin.settings.resourceTypes[this.existingKey]?.allowedParentClasses?.join(', ') 
                    : ''
                )
                .setPlaceholder('e.g., Topic, SubTopic');
            });

        // Requires Parent Toggle
        new Setting(contentEl)
            .setName('Requires Parent')
            .setDesc('Whether this resource type must have a parent')
            .addToggle(toggle => {
                this.requiresParentToggle = toggle;
                toggle.setValue(
                    this.existingKey 
                        ? !!this.plugin.settings.resourceTypes[this.existingKey]?.requiresParent 
                        : false
                );
            });

        new Setting(contentEl)
            .setName('Add Name as Tag')
            .setDesc('Automatically add the resource name as a tag')
            .addToggle(toggle => {
                this.addNameAsTagToggle = toggle;
                toggle.setValue(
                    this.existingKey 
                        ? !!this.plugin.settings.resourceTypes[this.existingKey]?.addNameAsTag 
                        : false
                );
            });
        
        // Move on Parent Change Toggle
        new Setting(contentEl)
        .setName('Move on Parent Change')
        .setDesc('Move file to new location when parent changes')
        .addToggle(toggle => {
            this.moveOnParentChangeToggle = toggle;
            toggle.setValue(
                this.existingKey 
                    ? !!this.plugin.settings.resourceTypes[this.existingKey]?.moveOnParentChange 
                    : false
            );
        });

        // Save Button
        new Setting(contentEl)
            .addButton(button => {
                button.setButtonText('Save')
                    .setCta()
                    .onClick(() => this.saveResourceType());
            });
    }

    private async saveResourceType() {
        const name = this.nameInput.getValue().trim();
        const folderName = this.folderNameInput.getValue().trim();
        const templatePath = this.templatePathInput.getValue().trim();
        const allowedParents = this.allowedParentsInput.getValue()
            .split(',')
            .map(p => p.trim())
            .filter(p => p);
        const requiresParent = this.requiresParentToggle.getValue();

        // Validate inputs
        if (!name || !folderName || !templatePath) {
            new Notice('Please fill in all required fields');
            return;
        }

        const newConfig: ResourceTypeSettings = {
            name,
            folderName,
            templatePath,
            allowedParentClasses: allowedParents,
            requiresParent,
            addNameAsTag: this.addNameAsTagToggle.getValue()
        };

        const key = this.existingKey || name.replace(/\s+/g, '');

        try {
            // Use the resource manager to add/update the resource type
            await this.resourceManager.addResourceType(key, newConfig);
            new Notice(`Resource type ${key} ${this.existingKey ? 'updated' : 'added'}`);
            this.close();

            // Refresh settings tab
            const settingsTab = this.plugin.settingTab;
            if (settingsTab) {
                settingsTab.display();
            }
        } catch (error) {
            new Notice(`Error: ${error.message}`);
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class FolderSuggestModal extends FuzzySuggestModal<TFolder | TFile> {
    constructor(
        app: App,
        private allowFiles: boolean,
        private onSelect: (item: TFolder | TFile | null) => void,
        private onCancel: () => void
    ) {
        super(app);
        this.setPlaceholder(allowFiles ? "Select folder or file" : "Select folder");
    }

    getItems(): (TFolder | TFile)[] {
        const items = this.app.vault.getAllLoadedFiles();
        return this.allowFiles 
            ? items
            : items.filter((file): file is TFolder => file instanceof TFolder);
    }

    getItemText(item: TFolder | TFile): string {
        return item.path;
    }

    onChooseItem(item: TFolder | TFile): void {
        this.onSelect(item);
        this.close();
    }

    onClose(): void {
        if (this.isOpen) {
            this.onCancel();
        }
        super.onClose();
    }
}