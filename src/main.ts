import { App, TFolder, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TAbstractFile, FuzzySuggestModal, TextComponent } from 'obsidian';
import matter from 'gray-matter';

interface MyPluginSettings {
    topicTemplatePath: string;
    subtopicTemplatePath: string;
    topicFolder: string;
    subtopicFolderName: string;
	selectorIgnoreFolderName: string;
    howToTemplatePath: string;
    howToFolderName: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
    topicTemplatePath: '99_Organize/Templates/TopicTemplate.md',
    subtopicTemplatePath: '99_Organize/Templates/SubtopicTemplate.md',
    topicFolder: '10_Topics',
    subtopicFolderName: '00_Subtopics',
	selectorIgnoreFolderName: '99_Organize',
    howToTemplatePath: '99_Organize/Templates/HowToTemplate.md',
    howToFolderName: '20_HowTos',
};


interface TopicData {
	file: TFile;
	subfolder: string;
	parentLink: string;
}

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
        const updatedContent = await this.templateService.updateFrontmatter(templateContent, {
            parent: `[[${selected.file.path}|${selected.file.basename}]]`,
            tags: inheritedTags,
        });
    
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

        if (parentFile) {
            const inheritedTags = await this.tagService.getInheritedTags(parentFile);
            updatedContent = await this.templateService.updateFrontmatter(templateContent, {
                parent: `[[${parentFile.path}|${parentFile.basename}]]`,
                tags: inheritedTags,
            });
        }

        const filePath = `${targetPath}/${name}.md`;
        const newFile = await this.fileService.createFile(filePath, updatedContent);
        await this.fileService.revealInExplorer(newFile);
        await this.fileService.openFile(newFile);

        new Notice(`Created new ${resourceType}: ${name}`);
    }
}

class ResourceManager extends BaseResourceCreator {
    private resourceTypes: Map<string, ResourceType>;

    constructor(
        plugin: MyPlugin,
        templateService: TemplateService,
        fileService: FileService,
        tagService: TagService
    ) {
        super(plugin, templateService, fileService, tagService);
        this.resourceTypes = new Map([
            ['HowTo', {
                name: 'How To',
                folderName: plugin.settings.howToFolderName,
                templatePath: plugin.settings.howToTemplatePath,
                allowedParentClasses: ['Topic', 'SubTopic']
            }]
        ]);
    }


    getResourceTypes(): string[] {
        return Array.from(this.resourceTypes.keys());
    }


    protected async createResource(resourceType: string): Promise<void> {
        const config = this.resourceTypes.get(resourceType);
        if (!config) return;

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

        // await this.createResourceFile(template, selected, resourceName, config.name);
        await this.createNoteResource(
            config.templatePath,
            selected.parentPath,
            resourceName,
            selected.file,
            config.name
        );

    }
    

    

}

class TemplateService {
    constructor(private app: App, private settings: MyPluginSettings) {}

    async loadTemplate(templatePath: string): Promise<TFile | null> {
        const template = await this.app.vault.getAbstractFileByPath(templatePath);
        return template instanceof TFile ? template : null;
    }

    async updateFrontmatter(content: string, updates: Record<string, any>): Promise<string> {
        const { data: frontmatter, content: templateContent } = matter(content);
        Object.assign(frontmatter, updates);
        return matter.stringify(templateContent, frontmatter);
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
        if (tag.contains(prefix)) return tag;
        return `${prefix}/${tag}`;
    }

    async getInheritedTags(file: TFile): Promise<string[]> {
        const tags = new Set<string>();
        const cache = this.app.metadataCache.getFileCache(file);
        const prefix = "inherited";

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
        const baseActions = ['New Topic', 'New Subtopic'];
        const resourceActions = Array.from(this.resourceManager.getResourceTypes()).map(type => `New ${type}`);
        return [...baseActions, ...resourceActions];
    }

    getItemText(action: string): string {
        return action; // Display the action text in the modal
    }

    async onChooseItem(action: string): Promise<void> {
        const actionMap: Record<string, () => Promise<void>> = {
            'New Topic': () => this.createTopic(),
            'New Subtopic': () => this.createSubtopic()
        };

        const handler = actionMap[action] || 
            (() => this.resourceManager.createResource(action.replace('New ', '')));
            
        await handler();
    }


    private async getSelectedTopic(): Promise<TopicData | null> {
        const topicSelector = new TopicSelectorModal(this.plugin.app, this.plugin.settings, ['Topic']);
        topicSelector.open();
        return new Promise((resolve) => {
            topicSelector.onChooseItem = async (file) => {
                const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
                if (frontmatter?.subfolder) {
                    resolve({
                        file,
                        subfolder: frontmatter.subfolder,
                        parentLink: `[[${file.path}|${file.basename}]]`,
                    });
                } else {
                    new Notice("Selected topic doesn't have a subfolder defined!");
                    resolve(null);
                }
            };
        });
    }

    private async getUserInput(placeholder: string): Promise<string | null> {
        const inputModal = new InputModal(this.plugin.app, placeholder);
        inputModal.open();
        return inputModal.getUserInput();
    }

    private async createTopic() {
        const topicName = await this.getUserInput('Enter topic name');
        if (!topicName) return;

        const template = await this.templateService.loadTemplate(this.plugin.settings.topicTemplatePath);
        if (!template) {
            new Notice('Topic template not found!');
            return;
        }

        const templateContent = await this.plugin.app.vault.read(template);
        const filePath = `${this.plugin.settings.topicFolder}/${topicName}.md`;
        const newFile = await this.fileService.createFile(filePath, templateContent);

        await this.fileService.revealInExplorer(newFile);
		await this.fileService.openFile(newFile);

        new Notice(`Created new topic: ${topicName}`);
    }

    private async createSubtopic() {
        const selectedTopic = await this.getSelectedTopic();
        if (!selectedTopic) return;

        const subtopicName = await this.getUserInput('Enter subtopic name');
        if (!subtopicName) return;

        const template = await this.templateService.loadTemplate(this.plugin.settings.subtopicTemplatePath);
        if (!template) {
            new Notice('Subtopic template not found!');
            return;
        }

        const templateContent = await this.plugin.app.vault.read(template);
        const inheritedTags = await this.tagService.getInheritedTags(selectedTopic.file);
        const updatedContent = await this.templateService.updateFrontmatter(templateContent, {
            parent: selectedTopic.parentLink,
            tags: inheritedTags,
        });

        const subtopicPath = `${selectedTopic.subfolder}/${this.plugin.settings.subtopicFolderName}/${subtopicName}.md`;
        const newFile = await this.fileService.createFile(subtopicPath, updatedContent);
		await this.fileService.revealInExplorer(newFile);
		await this.fileService.openFile(newFile);

        new Notice(`Created new subtopic: ${subtopicName}`);
    }

}

class NoteService {
    constructor(
        private app: App,
        private settings: MyPluginSettings,
        private fileService: FileService,
        private tagService: TagService
    ) {}

    async changeNoteParent(activeFile: TFile, newParent: TFile): Promise<void> {
        const content = await this.app.vault.read(activeFile);
        const { data: frontmatter, content: fileContent } = matter(content);
        
        frontmatter.parent = `[[${newParent.path}|${newParent.basename}]]`;
        frontmatter.tags = await this.tagService.getInheritedTags(newParent);
        const updatedContent = matter.stringify(fileContent, frontmatter);

        if (frontmatter.Class === 'SubTopic') {
            const parentFrontmatter = this.app.metadataCache.getFileCache(newParent)?.frontmatter;
            if (parentFrontmatter?.subfolder) {
                const newPath = `${parentFrontmatter.subfolder}/${this.settings.subtopicFolderName}/${activeFile.basename}.md`;
                await this.app.fileManager.renameFile(activeFile, newPath);
                const movedFile = this.app.vault.getAbstractFileByPath(newPath);
                if (movedFile instanceof TFile) {
                    await this.app.vault.modify(movedFile, updatedContent);
                }
            }
        } else {
            await this.app.vault.modify(activeFile, updatedContent);
        }
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

                const topicSelector = new TopicSelectorModal(this.app, this.settings, ['Topic']);
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

        // Topic Template Path Selector (allows files)
        this.createFolderSelector(
            containerEl,
            'Topic Template Path',
            'Path to the template for topics.',
            '99_Organize/Templates/TopicTemplate.md',
            'topicTemplatePath',
            true
        );

        // Subtopic Template Path Selector (allows files)
        this.createFolderSelector(
            containerEl,
            'Subtopic Template Path',
            'Path to the template for subtopics.',
            '99_Organize/Templates/SubtopicTemplate.md',
            'subtopicTemplatePath',
            true
        );

        // Topic Folder Selector
        this.createFolderSelector(
            containerEl,
            'Topic Folder',
            'Main folder for topics.',
            '10_Topics',
            'topicFolder',
            false
        );

        // Subtopic Folder Name Selector
        this.createFolderSelector(
            containerEl,
            'Subtopic Folder Name',
            'Name of the subtopics folder.',
            '00_Subtopics',
            'subtopicFolderName',
            false
        );

        // Selector Ignore Folder
        this.createFolderSelector(
            containerEl,
            'Selector Ignore Folder',
            'Folder to ignore when selecting topics.',
            '99_Organize',
            'selectorIgnoreFolderName',
            false
        );

        this.createFolderSelector(
            containerEl,
            'How To Template Path',
            'Path to the template for How To notes.',
            '99_Organize/Templates/HowToTemplate.md',
            'howToTemplatePath',
            true
        );

        // How To Folder Name Selector
        this.createFolderSelector(
            containerEl,
            'How To Folder Name',
            'Name of the How To folder.',
            '20_HowTos',
            'howToFolderName',
            false
        );

        // // Default Setting (regular text input)
        // const defaultSetting = new Setting(containerEl)
        //     .setName('Default Setting')
        //     .setDesc('Default setting for the plugin.')
        //     .addText(text => {
        //         text.inputEl.style.width = '100%';
        //         return text
        //             .setPlaceholder('default')
        //             .setValue(this.plugin.settings.defaultSetting)
        //             .onChange(async (value) => {
        //                 this.plugin.settings.defaultSetting = value;
        //                 await this.plugin.saveSettings();
        //             });
        //     });

        // // Style the default setting container
        // defaultSetting.settingEl.style.display = 'grid';
        // defaultSetting.settingEl.style.gridTemplateColumns = '1fr';
        // defaultSetting.settingEl.style.gap = '6px';

        // const defaultControlEl = defaultSetting.settingEl.querySelector('.setting-item-control');
        // if (defaultControlEl instanceof HTMLElement) {
        //     defaultControlEl.style.width = '100%';
        //     defaultControlEl.style.display = 'flex';
        //     defaultControlEl.style.justifyContent = 'flex-start';
        //     defaultControlEl.style.minWidth = '300px';
        // }



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