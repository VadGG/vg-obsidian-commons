import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TAbstractFile, FuzzySuggestModal, TextComponent } from 'obsidian';
import matter from 'gray-matter';


import { getFileValues } from 'src/utils/obsidianUtils';
// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default'
}

type Metadata = {
	[key: string]: string;
};


interface TopicData {
	file: TFile;
	subfolder: string;
	parentLink: string;
}

class InputModal extends Modal {
	private result: string;
	private inputEl: TextComponent;
	private resolvePromise: (value: string | null) => void;

	constructor(app: App, private placeholder: string) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		this.inputEl = new TextComponent(contentEl)
			.setPlaceholder(this.placeholder);

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
	constructor(private app: App) { }

	async getTemplate(templatePath: string): Promise<TFile | null> {
		const template = await this.app.vault.getAbstractFileByPath(templatePath);
		return template instanceof TFile ? template : null;
	}

	async updateFrontmatter(templateContent: string, updates: Record<string, any>): Promise<string> {
		const { data: frontmatter, content } = matter(templateContent);
		Object.assign(frontmatter, updates);
		return matter.stringify(content, frontmatter);
	}
}

class FileService {
	constructor(private app: App) { }

	async createAndReveal(path: string, content: string): Promise<TFile> {
		const newFile = await this.app.vault.create(path, content);
		const leaf = this.app.workspace.getLeaf();
		leaf.openFile(newFile);
		this.app.workspace.revealLeaf(leaf);
		return newFile;
	}

	async ensureFolder(path: string): Promise<void> {
		await this.app.vault.adapter.mkdir(path);
	}
}

class TopicSelectorModal extends FuzzySuggestModal<TFile> {
	constructor(app: App, private allowedClasses: string[]) {
		super(app);
		this.setPlaceholder(`Select a ${allowedClasses.join(" or ")} note`);

	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles().filter(file => {
			if (file.path.startsWith('99_Organize/')) {
				return false;
			}

			const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (!frontmatter?.Class) return false;

			const classMatch = this.allowedClasses.map(c => c.toLowerCase())
				.includes(frontmatter.Class.toLowerCase());

			// For Topic class, require subfolder field
			if (frontmatter.Class === 'Topic') {
				return classMatch && !!frontmatter.subfolder;
			}

			// For SubTopic, no additional requirements
			return classMatch;
		});
	}

	getItemText(file: TFile): string {
		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;

		if (frontmatter?.Class === 'SubTopic' && frontmatter.parent) {
			const parentMatch = frontmatter.parent.match(/\[\[.*\|(.*?)\]\]/) ||
				frontmatter.parent.match(/\[\[(.*?)\]\]/);
			const parentName = parentMatch ? parentMatch[1] : 'Unknown Parent';
			return `${parentName} - ${file.basename}`;
		}

		return file.basename;
	}

	onChooseItem(file: TFile): void {
		console.log("Selected file:", file);
	}
}

class ActionSelectorModal extends FuzzySuggestModal<string> {
	constructor(private plugin: MyPlugin, private templateService: TemplateService, private fileService: FileService) {
		super(plugin.app);
		this.setPlaceholder("Select action");
	}

	getItems(): string[] {
		return [
			"New Topic",
			"New Subtopic"
		];
	}

	getItemText(item: string): string {
		return item;
	}

	async onChooseItem(action: string): Promise<void> {
		switch (action) {
			case "New Topic":
				await this.handleNewTopic();
				break;
			case "New Subtopic":
				await this.handleNewSubtopic();
				break;
		}
	}
	private async getSelectedTopic(): Promise<TopicData | null> {
		const topicSelector = new TopicSelectorModal(this.app, ['Topic']);
		topicSelector.open();

		return new Promise<TopicData | null>((resolve) => {
			topicSelector.onChooseItem = async (file) => {
				const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
				if (frontmatter?.subfolder) {
					resolve({
						file,
						subfolder: frontmatter.subfolder,
						parentLink: `[[${file.path}|${file.basename}]]`
					});
				} else {
					new Notice("Selected topic doesn't have a subfolder defined!");
					resolve(null);
				}
			};
		});
	}

	private async getUserInput(placeholder: string): Promise<string | null> {
		const inputModal = new InputModal(this.app, placeholder);
		inputModal.open();
		return inputModal.getUserInput();
	}

	private async handleNewTopic() {
		const topicName = await this.getUserInput("Enter topic name");
		if (!topicName) return;

		const template = await this.app.vault.getAbstractFileByPath("99_Organize/Templates/TopicTemplate.md");
		if (!(template instanceof TFile)) {
			new Notice("Topic template not found!");
			return;
		}

		const templateContent = await this.app.vault.read(template);
		await this.fileService.createAndReveal(`10_Topics/${topicName}.md`, templateContent);
		new Notice(`Created new topic: ${topicName}`);
	}



	private async handleNewSubtopic() {
		const selectedTopic = await this.getSelectedTopic();
		if (!selectedTopic) return;

		const subtopicName = await this.getUserInput("Enter subtopic name");
		if (!subtopicName) return;

		// Read template
		const template = await this.app.vault.getAbstractFileByPath("99_Organize/Templates/SubtopicTemplate.md");
		if (!(template instanceof TFile)) {
			new Notice("Subtopic template not found!");
			return;
		}

		// Get inherited tags from parent hierarchy
		let templateContent = await this.app.vault.read(template);
		const inheritedTags = await this.getInheritedTags(selectedTopic.file);
		// const { data: frontmatter, content } = matter(templateContent);

		const updatedContent = await this.templateService.updateFrontmatter(templateContent, {
			parent: `[[${selectedTopic.file.path}|${selectedTopic.file.basename}]]`,
			tags: inheritedTags
		});
		const folderPath = `${selectedTopic.subfolder}/00_Subtopics`;
		await this.fileService.ensureFolder(folderPath);

		await this.fileService.createAndReveal(
			`${folderPath}/${subtopicName}.md`,
			updatedContent
		);

		new Notice(`Created new subtopic: ${subtopicName}`);
	}

	private async getInheritedTags(file: TFile): Promise<string[]> {
		const tags = new Set<string>();
		const cache = this.app.metadataCache.getFileCache(file);

		if (!cache?.frontmatter) return Array.from(tags);

		// Add current file's tags
		if (cache.frontmatter.tags) {
			const currentTags = Array.isArray(cache.frontmatter.tags)
				? cache.frontmatter.tags
				: [cache.frontmatter.tags];
			currentTags.forEach(tag => tags.add(tag));
		}

		// Get parent and recurse up the ancestry
		if (cache.frontmatter.parent) {
			const parentMatch = cache.frontmatter.parent.match(/\[\[(.*?)(?:\|.*?)?\]\]/);

			if (parentMatch) {
				const parentPath = parentMatch[1];
				let parentFile: TAbstractFile | null;

				parentFile = this.app.metadataCache.getFirstLinkpathDest(parentPath, file.path);
				if (!parentFile) {
					parentFile = this.app.metadataCache.getFirstLinkpathDest(parentPath, file.path);
				}

				if (parentFile instanceof TFile) {
					const parentTags = await this.getInheritedTags(parentFile);
					parentTags.forEach(tag => tags.add(tag));
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

	onFileFileModified(file: TAbstractFile) {
		console.log('file saved');
		console.log(file);

		if (file instanceof TFile) {
			// TODO update tags when file is saved
		} else {
			console.log("Unknown file type");
		}
	}

	async onload() {
		await this.loadSettings();

		const templateService = new TemplateService(this.app);
		const fileService = new FileService(this.app);

		this.addCommand({
			id: 'create-new-content',
			name: 'Create New Content',
			callback: () => {
				new ActionSelectorModal(this, templateService, fileService).open();
			}
		});

		// TODO listen to modify file event
		// this.registerEvent(this.app.vault.on('modify', this.onFileFileModified.bind(this)));

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('dice', 'Sample Plugin', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice('This is a changed notice');

			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile) {

				console.log(getFileValues(activeFile, 'subject_folder'));
			} else {
				console.log("No active file");
			}

		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status Bar Text');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-sample-modal-simple',
			name: 'Open sample modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
			}
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'sample-editor-command',
			name: 'Sample editor command',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				// console.log(editor.getSelection());
				editor.replaceSelection('Sample Editor Command');
			}
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-sample-modal-complex',
			name: 'Open sample modal (complex)',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			// console.log('click', evt);
		});



		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		// this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
