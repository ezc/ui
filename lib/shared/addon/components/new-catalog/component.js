import { computed } from '@ember/object';
import { scheduleOnce } from '@ember/runloop';
import { alias, notEmpty } from '@ember/object/computed';
import { inject as service } from '@ember/service';
import Component from '@ember/component';
import NewOrEdit from 'shared/mixins/new-or-edit';
import C from 'ui/utils/constants';
import Util from 'ui/utils/util';
import { compare as compareVersion } from 'ui/utils/parse-version';
import { task } from 'ember-concurrency';
import YAML from 'npm:yamljs';
import layout from './template';


export default Component.extend(NewOrEdit, {
  layout,
  catalog:                  service(),
  intl:                     service(),
  scope:                 service(),
  router:                   service(),
  settings:                 service(),

  allTemplates:             null,
  templateResource:         null,
  namespaceResource:        null,
  versionsArray:            null,
  versionsLinks:            null,
  actuallySave:             true,
  showHeader:               true,
  showPreview:              true,
  showName:                 true,
  titleAdd:                 'newCatalog.titleAdd',
  titleUpgrade:             'newCatalog.titleUpgrade',
  selectVersionAdd:         'newCatalog.selectVersionAdd',
  selectVersionUpgrade:     'newCatalog.selectVersionUpgrade',
  saveUpgrade:              'newCatalog.saveUpgrade',
  saveNew:                  'newCatalog.saveNew',
  sectionClass:             'box mb-20',
  showDefaultVersionOption: false,

  classNames:               ['launch-catalog'],

  primaryResource:          alias('namespaceResource'),
  templateBase:             alias('templateResource.templateBase'),
  editing:                  notEmpty('namespaceResource.id'),

  previewOpen:              false,
  previewTab:               null,
  questionsArray:           null,
  selectedTemplateUrl:      null,
  selectedTemplateModel:    null,
  readmeContent:            null,
  pastedAnswers:            null,

  actions: {
    cancel: function() {
      this.sendAction('cancel');
    },

    togglePreview: function() {
      this.toggleProperty('previewOpen');
    },

    selectPreviewTab: function(tab) {
      this.set('previewTab', tab);
    },

    changeTemplate: function(tpl) {
      this.get('router').transitionTo('catalog-tab.launch', tpl.id);
    },

    saveTemplate() {
      this.sendAction('templateEdited', this.get('namespaceResource'));
    }
  },

  didReceiveAttrs: function() {
    this._super(...arguments);
    this.set('selectedTemplateModel', null);

    scheduleOnce('afterRender', () => {
      if ( this.get('selectedTemplateUrl') ) {
        this.templateChanged();
      } else {
        var def = this.get('templateResource.defaultVersion');
        var links = this.get('versionLinks');
        if (links[def]) {
          this.set('selectedTemplateUrl', links[def]);
        } else {
          this.set('selectedTemplateUrl', null);
        }
      }
    });
  },

  updateReadme: function() {
    let model = this.get('selectedTemplateModel');
    this.set('readmeContent', null);
    if ( model && model.hasLink('readme') ) {
      model.followLink('readme').then((response) => {
        this.set('readmeContent', response);
      });
    }
  },

  sortedVersions: function() {
    let out = this.get('versionsArray').sort((a,b) => {
      if ( a.sortVersion && b.sortVersion ) {
        return compareVersion(a.sortVersion, b.sortVersion);
      } else {
        return compareVersion(a.version, b.version);
      }
    });

    let def = this.get('templateResource.defaultVersion');
    if ( this.get('showDefaultVersionOption') && this.get('defaultUrl') ) {
      out.unshift({version:  this.get('intl').t('newCatalog.version.default', {version: def}), link: 'default'});
    }

    return out;
  }.property('versionsArray','templateResource.defaultVersion'),

  defaultUrl: function() {
    var defaultVersion = this.get('templateResource.defaultVersion');
    var versionLinks = this.get('versionLinks');

    if ( defaultVersion && versionLinks && versionLinks[defaultVersion] ) {
      return versionLinks[defaultVersion];
    }

    return null;
  }.property('templateResource.defaultVersion','versionLinks'),

  getTemplate: task(function * () {
    var url = this.get('selectedTemplateUrl');

    if ( url === 'default' ) {
      let defaultUrl = this.get('defaultUrl');
      if ( defaultUrl ) {
        url = defaultUrl;
      } else {
        url = null;
      }
    }

    if (url) {
      var version = this.get('settings.rancherVersion');

      if ( version ) {
        url = Util.addQueryParam(url, 'rancherVersion', version);
      }

      var current = this.get('namespaceResource.answers');

      if ( !current ) {
        current = {};
        this.set('namespaceResource.answers', current);
      }

      var selectedTemplateModel = yield this.get('catalog').fetchByUrl(url).then((response) => {
        if (response.questions) {
          response.questions.forEach((item) => {
            // This will be the component that is rendered to edit this answer
            item.inputComponent = 'schema/input-'+item.type;

            // Only types marked supported will show the component, Ember will explode if the component doesn't exist
            item.supported = C.SUPPORTED_SCHEMA_INPUTS.indexOf(item.type) >= 0;

            if (typeof current[item.variable] !== 'undefined') {
              // If there's an existing value, use it (for upgrade)
              item.answer = current[item.variable];
            } else if (item.type === 'service' || item.type === 'certificate') {
                // Loaded async and then the component picks the default
            } else if ( item.type === 'boolean' ) {
              // Coerce booleans
              item.answer = (item.default === 'true' || item.default === true);
            } else {
              // Everything else
              item.answer = item.default;
            }
          });
        }
        return response;
      });

      this.set('selectedTemplateModel', selectedTemplateModel);
      this.set('previewTab', Object.keys(selectedTemplateModel.get('files')||[])[0]);
    } else {
      this.set('selectedTemplateModel', null);
      this.set('readmeContent', null);
    }

    this.updateReadme();
  }),

  templateChanged: function() {
    this.get('getTemplate').perform();
  }.observes('selectedTemplateUrl','templateResource.defaultVersion'),

  answers: function() {
    var out = {};
    (this.get('selectedTemplateModel.questions') || []).forEach((item) => {
      out[item.variable] = item.answer;
    });

    return out;
  }.property('selectedTemplateModel.questions.@each.{variable,answer}'),

  answersArray: alias('selectedTemplateModel.questions'),

  answersString: computed('answersArray.@each.{variable,answer}', function() {
    let neu = {};
    this.get('answersArray').forEach((a) => {
      neu[a.variable] = a.answer || a.default;
    });
    return YAML.stringify(neu);
  }),

  validate() {
    var errors = [];

    if (!this.get('editing') && !this.get('namespaceResource.name')) {
      errors.push('Name is required');
    }

    if (this.get('selectedTemplateModel.questions')) {
      this.get('selectedTemplateModel.questions').forEach((item) => {
        if (item.required && item.type !== 'boolean' && !item.answer) {
          errors.push(`${item.label} is required`);
        }
      });
    }

    if (errors.length) {
      this.set('errors', errors.uniq());
      return false;
    }

    return true;
  },

  newExternalId: function() {
    return C.EXTERNAL_ID.KIND_CATALOG + C.EXTERNAL_ID.KIND_SEPARATOR + this.get('selectedTemplateModel.id');
  }.property('selectedTemplateModel.id'),

  willSave() {
    this.set('errors', null);
    var ok = this.validate();
    if (!ok) {
      // Validation failed
      return false;
    }

    let namespace = this.get('namespaceResource');

    if ( this.get('actuallySave') ) {
      namespace.setProperties({
        answers: this.get('answers'),
        externalId: this.get('newExternalId'),
      });

      return true;
    } else {
      let versionId = null;
      if ( this.get('selectedTemplateUrl') !== 'default' && this.get('selectedTemplateModel') ) {
        versionId = this.get('selectedTemplateModel.id');
      }

      this.sendAction('doSave', {
        answers:           this.get('answers'),
        externalId:        this.get('newExternalId'),
        templateId:        this.get('templateResource.id'),
        templateVersionId: versionId,
      });
      return false;
    }
  },

  doneSaving() {
    var projectId = this.get('scope.currentProject.id');
    return this.get('router').transitionTo('apps-tab.index', projectId);
  }
});
