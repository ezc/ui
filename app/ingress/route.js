import { hash } from 'rsvp';
import { get } from '@ember/object';
import Route from '@ember/routing/route';

export default Route.extend({
  model: function (params) {
    const store = get(this, 'store');
    return hash({
      ingress: store.find('ingress', params.ingress_id),
      allCertificates: store.findAll('certificate'),
    });
  },
});
