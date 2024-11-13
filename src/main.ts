import { App, TFolder, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TAbstractFile, FuzzySuggestModal, TextComponent } from 'obsidian';
import matter from 'gray-matter';

interface MyPluginSettings {
    topicTemplatePath: string;
    subtopicTemplatePath: string;
    topicFolder: string;
    subtopicFolderName: string;
	selectorIgnoreFolderName: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
    topicTemplatePath: '99_Organize/Templates/TopicTemplate.md',
    subtopicTemplatePath: '99_Organize/Templates/SubtopicTemplate.md',
    topicFolder: '10_Topics',
    subtopicFolderName: '00_Subtopics',
	selectorIgnoreFolderName: '99_Organize',
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
        return await this.app.vault.create(path, content);
    }

	async openFile(file: TFile): Promise<void> {
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(file);
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

    async getInheritedTags(file: TFile): Promise<string[]> {
        const tags = new Set<string>();
        const cache = this.app.metadataCache.getFileCache(file);
        
        // Add current file tags
        if (cache?.frontmatter?.tags) {
            const currentTags = Array.isArray(cache.frontmatter.tags) 
                ? cache.frontmatter.tags 
                : [cache.frontmatter.tags];
            currentTags.forEach(tag => tags.add(tag));
        }

        // Get parent's tags
        if (cache?.frontmatter?.parent) {
            const parentMatch = cache.frontmatter.parent.match(/\[\[(.*?)(?:\|.*?)?\]\]/);
            if (parentMatch) {
                const parentFile = this.app.metadataCache.getFirstLinkpathDest(parentMatch[1], file.path);
                if (parentFile instanceof TFile) {
                    const parentTags = await this.getInheritedTags(parentFile);
                    parentTags.forEach(tag => tags.add(`inherited/${tag}`));
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
    constructor(
        private plugin: MyPlugin,
        private templateService: TemplateService,
        private fileService: FileService,
        private tagService: TagService,
    ) {
        super(plugin.app);
        this.setPlaceholder('Select action');
    }

    getItems(): string[] {
        return ['New Topic', 'New Subtopic'];
    }

    getItemText(action: string): string {
        return action; // Display the action text in the modal
    }

    async onChooseItem(action: string): Promise<void> {
        switch (action) {
            case 'New Topic':
                await this.createTopic();
                break;
            case 'New Subtopic':
                await this.createSubtopic();
                break;
        }
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
        const inheritedTags = await this.getInheritedTags(selectedTopic.file);
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

    private async getInheritedTags(file: TFile): Promise<string[]> {
        const tags = new Set<string>();
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        if (cache?.frontmatter?.tags) {
            const currentTags = Array.isArray(cache.frontmatter.tags) ? cache.frontmatter.tags : [cache.frontmatter.tags];
            currentTags.forEach((tag) => tags.add(tag));
        }

        if (cache?.frontmatter?.parent) {
            const parentMatch = cache.frontmatter.parent.match(/\[\[(.*?)(?:\|.*?)?\]\]/);
            if (parentMatch) {
                const parentFile = this.plugin.app.metadataCache.getFirstLinkpathDest(parentMatch[1], file.path);
                if (parentFile instanceof TFile) {
                    (await this.getInheritedTags(parentFile)).forEach((tag) => tags.add(tag));
                }
            }
        }

        return Array.from(tags);
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

		this.addSettingTab(new SettingTab(this.app, this));
        // this.addCommand(id: "", name: "Open Action Selector", callback: () => new ActionSelectorModal(this, templateService, fileService).open());

		this.addCommand({
			id: 'create-new-content',
			name: 'Create New Content',
			callback: () => {
				new ActionSelectorModal(this, templateService, fileService, tagService).open();
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